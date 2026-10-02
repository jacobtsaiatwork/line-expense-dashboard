/**
 * ==============================================================================
 * 🤖 個人財務助理 LINE Bot + Google Sheets + 儀表板 API (Code.gs)
 * ==============================================================================
 * 
 * 核心功能：
 * 1. 【doPost】支援「文字自然語言」、「拍照/發票/便當/彩券」
 * 2. 【查帳功能】輸入「查詢」或「查帳」列出本月最近 10 筆編號明細
 * 3. 【精準刪除】輸入「刪除」刪除最後一筆；輸入「刪除 3」刪除指定編號
 * 4. 【精準修改】輸入「改 3 金額 150」或「改 3 項目 威力彩」即時更正
 * 5. 【極速回覆】配置 thinkingLevel: "low" 縮短推論時間（1~3秒秒回）
 * 6. 【雙向同步】明細刪修會自動同步更新「月度彙總」工作表金額
 * ==============================================================================
 */

// ==============================================================================
// 1. 核心參數設定區
// ==============================================================================
const CONFIG = {
  LINE_CHANNEL_ACCESS_TOKEN: getSecret('LINE_CHANNEL_ACCESS_TOKEN', '請填入你的LINE_TOKEN'),
  GEMINI_API_KEY: getSecret('GEMINI_API_KEY', '請填入你的GEMINI_API_KEY'),
  SPREADSHEET_ID: getSecret('SPREADSHEET_ID', '')
};

// 官方現行極速且支援多模態視覺辨識的 Gemini 3 系列模型清單
const GEMINI_MODELS = [
  'gemini-3.5-flash-lite', // 極速、低延遲主力首選
  'gemini-3.5-flash',      // 視覺多模態旗艦
  'gemini-3.1-flash-lite'  // 備援
];

// 七大分類標準白名單
const VALID_CATEGORIES = ['餐飲', '生活', '家用', '社交', '娛樂', '交通', '雜支'];

function getSecret(key, defaultValue = '') {
  try {
    const prop = PropertiesService.getScriptProperties().getProperty(key);
    if (prop && prop.trim()) {
      return prop.trim();
    }
  } catch (e) {}
  return (defaultValue || '').trim();
}

function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID && !CONFIG.SPREADSHEET_ID.startsWith('YOUR_') && !CONFIG.SPREADSHEET_ID.startsWith('請填入')) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ==============================================================================
// 2. LINE Webhook 接收與處理核心 (doPost)
// ==============================================================================
function doPost(e) {
  if (!e || !e.postData) {
    return ContentService.createTextOutput("錯誤：請勿在 GAS 編輯器直接點擊執行 doPost。");
  }

  try {
    const postData = JSON.parse(e.postData.contents);
    const events = postData.events;

    if (!events || events.length === 0) {
      return ContentService.createTextOutput("OK");
    }

    const cache = CacheService.getScriptCache();

    for (const event of events) {
      if (event.type !== 'message') {
        continue;
      }

      const replyToken = event.replyToken;
      const eventId = event.webhookEventId || replyToken;
      const userId = (event.source && event.source.userId) ? event.source.userId : 'default';

      // 【去重機制】1 分鐘內防重複處理
      const cacheKey = 'line_evt_' + eventId;
      if (cache.get(cacheKey)) {
        Logger.log(`⚠️ 忽略重複事件: ${eventId}`);
        continue;
      }
      cache.put(cacheKey, 'processed', 60);

      const msgType = event.message.type;

      // ----------------------------------------------------
      // 情境 A：使用者傳送「純文字」
      // ----------------------------------------------------
      if (msgType === 'text') {
        const userText = (event.message.text || '').trim();

        // 1. 系統連線測試
        if (userText.toLowerCase() === 'ping') {
          replyToLine(replyToken, 'pong 🏓 系統連線正常！');
          continue;
        }

        // 2. 查詢本月明細（輸入：查詢、查帳、明細、本月明細、list）
        const queryCmds = ['查詢', '查帳', '明細', '本月明細', 'list', '查看'];
        if (queryCmds.includes(userText.toLowerCase())) {
          const queryMsg = getMonthlyListMessage(userId);
          replyToLine(replyToken, queryMsg);
          continue;
        }

        // 3. 刪除指令
        // A. 刪除指定編號（例如：「刪除 3」、「del 2」）
        const delIndexMatch = userText.match(/^(?:刪除|del|delete)\s*(\d+)$/i);
        if (delIndexMatch) {
          const indexNum = parseInt(delIndexMatch[1], 10);
          const delRes = deleteRecordByIndex(indexNum, userId);
          replyToLine(replyToken, delRes.message);
          continue;
        }

        // B. 刪除最後一筆（例如：「刪除」、「刪除上一筆」、「undo」、「復原」）
        const deleteLastCmds = ['刪除', '刪除上一筆', '刪除最後一筆', 'undo', '復原'];
        if (deleteLastCmds.includes(userText.toLowerCase())) {
          const delRes = deleteLastRecord();
          if (delRes.success) {
            replyToLine(replyToken, `🗑️ 已成功刪除上一筆紀錄！\n項目：${delRes.item}\n金額：${delRes.amount} 元\n分類：${delRes.category}`);
          } else {
            replyToLine(replyToken, `⚠️ ${delRes.message}`);
          }
          continue;
        }

        // 4. 修改指定編號指令（例如：「改 3 金額 150」、「改 3 項目 威力彩」、「改 3 分類 生活」）
        const modMatch = userText.match(/^(?:修改|改)\s*(\d+)\s*(.+)$/i);
        if (modMatch) {
          const indexNum = parseInt(modMatch[1], 10);
          const modContent = modMatch[2].trim();
          const modRes = modifyRecordByIndex(indexNum, modContent, userId);
          replyToLine(replyToken, modRes.message);
          continue;
        }

        // 5. 一般文字自然語言記帳
        try {
          const parsedData = callGeminiText(userText);
          writeToSheet(parsedData.item, parsedData.category, parsedData.amount);
          const replyMessage = `✅ 記帳成功\n項目：${parsedData.item}\n金額：${parsedData.amount}\n分類：${parsedData.category}`;
          replyToLine(replyToken, replyMessage);

        } catch (err) {
          Logger.log(`❌ 文字記帳失敗: ${err.message}`);
          const helpMessage = `❓ 無法辨識消費內容。\n請嘗試輸入範例：「午餐排骨便當 120」\n• 查帳請輸入「查詢」\n• 刪除請輸入「刪除」\n(除錯: ${err.message})`;
          replyToLine(replyToken, helpMessage);
        }

      // ----------------------------------------------------
      // 情境 B：使用者傳送「拍照 / 發票照片 / 超商便當 / 彩券」
      // ----------------------------------------------------
      } else if (msgType === 'image') {
        const messageId = event.message.id;

        try {
          // 1. 從 LINE 下載照片轉 Base64
          const imageObj = fetchLineImage(messageId);

          // 2. 呼叫 Gemini Vision 進行多模態辨識
          const parsedData = callGeminiVision(imageObj);

          // 3. 寫入 Google 試算表
          writeToSheet(parsedData.item, parsedData.category, parsedData.amount);

          // 4. 回覆成功訊息（附上品項備註）
          let replyMessage = `📸 拍照記帳成功！\n項目：${parsedData.item}\n金額：${parsedData.amount}\n分類：${parsedData.category}`;
          if (parsedData.note) {
            replyMessage += `\n備註：${parsedData.note}`;
          }

          replyToLine(replyToken, replyMessage);

        } catch (err) {
          Logger.log(`❌ 拍照記帳失敗: ${err.message}`);
          const helpMessage = `❓ 抱歉，無法清晰辨識照片中的內容。\n請確保照片清晰、無強烈反光，或改用文字記帳。\n(除錯: ${err.message})`;
          replyToLine(replyToken, helpMessage);
        }
      }
    }

    return ContentService.createTextOutput("OK");

  } catch (globalError) {
    Logger.log(`❌ doPost 異常: ${globalError.message}`);
    return ContentService.createTextOutput("ERROR: " + globalError.message);
  }
}

// ==============================================================================
// 3. LINE 圖片下載模組
// ==============================================================================
function fetchLineImage(messageId) {
  const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || token.startsWith('YOUR_') || token.startsWith('請填入')) {
    throw new Error('未設定 LINE_CHANNEL_ACCESS_TOKEN');
  }

  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const response = UrlFetchApp.fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + token
    },
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  if (statusCode !== 200) {
    throw new Error(`下載 LINE 圖片失敗 (HTTP ${statusCode})`);
  }

  const blob = response.getBlob();
  return {
    base64: Utilities.base64Encode(blob.getBytes()),
    mimeType: blob.getContentType() || 'image/jpeg'
  };
}

// ==============================================================================
// 4. Gemini API 呼叫核心（純文字解析）
// ==============================================================================
function callGeminiText(userText) {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');

  const systemPrompt = `你是一個專業個人記帳助理。請從使用者的自然語言訊息中，精準擷取「項目名稱」、「分類類別」與「消費金額」。
今天是：${todayStr}。

【七大標準分類規則（必須且僅能從中擇一）】
1. 「餐飲」：正餐、午餐、便當、超商熟食、全家、7-11、早餐、手搖飲料、點心
2. 「生活」：食材買菜、水電瓦斯日常必要費用
3. 「家用」：房租、家具、日用耗材、修繕裝潢、家電器材
4. 「社交」：聚餐、請客、送禮、紅白包、朋友分帳
5. 「娛樂」：彩券、大樂透、威力彩、刮刮樂、電影、遊戲課金、Netflix/Spotify訂閱、旅遊玩樂
6. 「交通」：捷運、公車、計程車、Uber、高鐵、火車、加油、機車汽車保養、停車費、悠遊卡加值
7. 「雜支」：看醫生診所掛號費、藥品、無法歸類之臨時支出

【項目名稱原則】
- 保持使用者輸入的原貌精髓，例如「全家」、「排骨便當」、「搭Uber」、「加油」、「大樂透」。
- 絕對禁止自行添加「消費」、「支出」、「花費」、「購買」等贅字。

【回傳格式】
嚴格只回傳乾淨的 JSON，禁止任何 Markdown 語法或額外文字說明：
{"item": "項目名稱", "category": "餐飲|生活|家用|社交|娛樂|交通|雜支", "amount": 數字}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          { text: `使用者輸入：「${userText}」` }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: "low"
      },
      temperature: 0.1
    }
  };

  return executeGeminiRequest(payload);
}

// ==============================================================================
// 5. Gemini API 呼叫核心（照片/發票/超商便當/彩券多模態視覺辨識）
// ==============================================================================
function callGeminiVision(imageObj) {
  const now = new Date();
  const todayStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd');

  const systemPrompt = `你是一個專業個人記帳與視覺辨識助理。
今天是：${todayStr}。
這張照片可能是：
1. 台灣超商/超市商品（如：便當、微波食品、飲料、麵包的包裝價格標籤）
2. 統一發票證明聯 / 傳統收據 / 購買明細清單
3. 台灣公益彩券（如：大樂透、威力彩、今彩539、刮刮樂、運動彩券）
4. 餐廳點菜單 / 飲料杯貼紙 / 刷卡簽單 / 菜單價目表

【辨識規則】
1. 「項目名稱 (item)」：
   - 若為台灣彩券（如大樂透、威力彩）：填寫彩券名稱（例如「大樂透」、「威力彩」）。
   - 若為超商便當/商品：提取完整品名（例如「經典奮起湖便當」、「抹茶拿鐵」）。
   - 若為發票/收據：優先填寫商家或品牌名稱（例如「全家」、「7-ELEVEN」、「家樂福」）。
2. 「消費金額 (amount)」：
   - 若為彩券：尋找「總金額: NT$數字」或「總計」。
   - 若為商品包裝/便當：辨識標籤上的「售價」、「價格」或「$金額」，若有打折標籤（如友善食光7折、i珍食65折）請以折扣後實付金額為準。
   - 若為發票/收據：尋找「總計」、「應付金額」、「實付金額」、「TOTAL」。
   - 絕對排除發票號碼、彩券選號號碼、期別序號、找零金額。
   - 只回傳純數字整數。
3. 「分類類別 (category)」：必須且僅能從以下七大分類中擇一：
   餐飲 / 生活 / 家用 / 社交 / 娛樂 / 交通 / 雜支
   (彩券、大樂透、刮刮樂請歸為「娛樂」；便當熟食請歸為「餐飲」)
4. 「品項備註 (note)」：
   - 簡短備註（例如：「計1期 2注」或「友善食光7折」），15字以內。

【回傳格式】
嚴格只回傳乾淨的 JSON，禁止任何 Markdown 語法或額外文字：
{"item": "品名或商家", "category": "分類", "amount": 數字, "note": "備註"}`;

  const payload = {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          {
            inlineData: {
              mimeType: imageObj.mimeType,
              data: imageObj.base64
            }
          },
          { text: "請辨識這張圖片中的發票、彩券、便當售價或消費單據，精準擷取項目名稱、總金額與分類。" }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: {
        thinkingLevel: "low"
      },
      temperature: 0.1
    }
  };

  return executeGeminiRequest(payload);
}

// ==============================================================================
// 6. 通用 Gemini 請求發送器（多模型備援機制）
// ==============================================================================
function executeGeminiRequest(payload) {
  const apiKey = CONFIG.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith('YOUR_') || apiKey.startsWith('請填入')) {
    throw new Error('未設定 GEMINI_API_KEY，請填入有效金鑰');
  }

  let errorLogs = [];

  for (const modelId of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (statusCode === 200) {
        const resJson = JSON.parse(responseText);
        const rawContent = resJson.candidates?.[0]?.content?.parts?.[0]?.text;

        if (rawContent) {
          const cleanedText = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleanedText);

          if (parsed && parsed.item && parsed.amount != null) {
            let cat = String(parsed.category || '生活').trim();
            if (!VALID_CATEGORIES.includes(cat)) {
              cat = '雜支';
            }

            let cleanItem = String(parsed.item).trim()
              .replace(/(消費|花費|支出|購買)$/, '')
              .trim();
            if (!cleanItem) cleanItem = String(parsed.item).trim();

            const result = {
              item: cleanItem,
              category: cat,
              amount: Math.abs(Number(parsed.amount)) || 0,
              note: parsed.note ? String(parsed.note).trim() : ''
            };

            Logger.log(`✅ [${modelId}] 解析成功: ${JSON.stringify(result)}`);
            return result;
          }
        }
      } else {
        Logger.log(`⚠️ 模型 [${modelId}] 回應 HTTP ${statusCode}: ${responseText.slice(0, 180)}`);
        errorLogs.push(`[${modelId}: HTTP ${statusCode}]`);
      }
    } catch (e) {
      Logger.log(`⚠️ 模型 [${modelId}] 請求異常: ${e.message}`);
      errorLogs.push(`[${modelId}: ${e.message}]`);
    }
  }

  throw new Error(`所有備援模型皆無回應 (${errorLogs.join(', ')})`);
}

// ==============================================================================
// 7. 查帳、刪除與修改明細模組
// ==============================================================================

/**
 * 取得本月明細列表並快取行號
 */
function getMonthlyListMessage(userId) {
  const ss = getSpreadsheet();
  const detailSheet = ss.getSheetByName('記帳明細') || ss.getSheets()[0];
  const lastRow = detailSheet.getLastRow();

  if (lastRow <= 1) {
    return '📋 目前試算表中尚無任何記帳紀錄。';
  }

  const now = new Date();
  const currentMonth = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM');

  const data = detailSheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const displayValues = detailSheet.getRange(2, 1, lastRow - 1, 5).getDisplayValues();

  // 篩選本月的紀錄
  const monthItems = [];
  for (let i = 0; i < data.length; i++) {
    const rowMonth = String(data[i][4] || '').trim();
    if (rowMonth === currentMonth || rowMonth.startsWith(currentMonth)) {
      monthItems.push({
        sheetRow: i + 2,
        time: displayValues[i][0],
        item: displayValues[i][1],
        category: displayValues[i][2],
        amount: Number(data[i][3]) || 0,
        amountStr: displayValues[i][3]
      });
    }
  }

  if (monthItems.length === 0) {
    return `📋 本月 (${currentMonth}) 尚無任何記帳紀錄。`;
  }

  // 取最近 10 筆
  const recentItems = monthItems.slice(-10);
  const rowMapping = {};

  let msg = `📋 本月 (${currentMonth}) 最近 ${recentItems.length} 筆明細：\n`;

  let totalMonthSpend = 0;
  monthItems.forEach(item => totalMonthSpend += item.amount);

  recentItems.forEach((it, idx) => {
    const indexNum = idx + 1;
    rowMapping[indexNum] = it.sheetRow;

    // 格式化時間（只取 月/日）
    let datePart = '';
    const dateMatch = it.time.match(/(\d+)\/(\d+)\s/);
    if (dateMatch) {
      datePart = `${dateMatch[1]}/${dateMatch[2]} `;
    }

    msg += `\n[${indexNum}] ${datePart}${it.item} $${it.amountStr} (${it.category})`;
  });

  msg += `\n\n💰 本月累積總計：$${totalMonthSpend.toLocaleString()} 元`;
  msg += `\n-----------------------`;
  msg += `\n💡 快捷操作指令：`;
  msg += `\n• 刪除特定筆：輸入「刪除 數字」（例：刪除 ${recentItems.length}）`;
  msg += `\n• 修改金額：輸入「改 數字 金額 數值」（例：改 ${recentItems.length} 金額 200）`;
  msg += `\n• 修改項目：輸入「改 數字 項目 名稱」`;
  msg += `\n• 刪除最後一筆：直接輸入「刪除」`;

  // 將當前查詢的行號存入 Cache（有效期 30 分鐘）
  try {
    const cache = CacheService.getScriptCache();
    cache.put('query_rows_' + userId, JSON.stringify(rowMapping), 1800);
  } catch (e) {}

  return msg;
}

/**
 * 依編號刪除特定紀錄
 */
function deleteRecordByIndex(indexNum, userId) {
  const ss = getSpreadsheet();
  const detailSheet = ss.getSheetByName('記帳明細') || ss.getSheets()[0];
  const lastRow = detailSheet.getLastRow();

  if (lastRow <= 1) {
    return { success: false, message: '目前沒有任何明細紀錄可供刪除。' };
  }

  let targetRow = null;

  // 1. 嘗試從快取取得對應行號
  try {
    const cache = CacheService.getScriptCache();
    const cachedStr = cache.get('query_rows_' + userId);
    if (cachedStr) {
      const mapping = JSON.parse(cachedStr);
      if (mapping && mapping[indexNum]) {
        targetRow = mapping[indexNum];
      }
    }
  } catch (e) {}

  // 2. 若快取過期，動態重新抓取本月最後 10 筆推算行號
  if (!targetRow) {
    const now = new Date();
    const currentMonth = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM');
    const data = detailSheet.getRange(2, 5, lastRow - 1, 1).getValues();
    const monthRows = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim().startsWith(currentMonth)) {
        monthRows.push(i + 2);
      }
    }
    const recentRows = monthRows.slice(-10);
    if (indexNum >= 1 && indexNum <= recentRows.length) {
      targetRow = recentRows[indexNum - 1];
    }
  }

  if (!targetRow || targetRow > detailSheet.getLastRow()) {
    return { success: false, message: `找不到編號 [${indexNum}] 的紀錄。\n請先輸入「查詢」查看最新編號！` };
  }

  const rowValues = detailSheet.getRange(targetRow, 1, 1, 5).getValues()[0];
  const item = rowValues[1];
  const category = rowValues[2];
  const amount = Number(rowValues[3]) || 0;
  const monthStr = String(rowValues[4] || '').trim();

  // 刪除該行
  detailSheet.deleteRow(targetRow);

  // 同步從月度彙總扣除
  if (monthStr && amount > 0) {
    deductMonthlySummary(ss, monthStr, amount);
  }

  // 清除快取讓下次查詢重整
  try {
    CacheService.getScriptCache().remove('query_rows_' + userId);
  } catch (e) {}

  return {
    success: true,
    message: `🗑️ 已成功刪除第 [${indexNum}] 筆紀錄！\n項目：${item}\n金額：${amount.toLocaleString()} 元\n分類：${category}\n\n已同步扣除月度彙總金額。`
  };
}

/**
 * 依編號修改特定紀錄（支援修改金額、項目、分類）
 */
function modifyRecordByIndex(indexNum, modContent, userId) {
  const ss = getSpreadsheet();
  const detailSheet = ss.getSheetByName('記帳明細') || ss.getSheets()[0];
  const lastRow = detailSheet.getLastRow();

  if (lastRow <= 1) {
    return { success: false, message: '目前沒有任何明細紀錄可供修改。' };
  }

  let targetRow = null;

  // 1. 嘗試從快取取得行號
  try {
    const cache = CacheService.getScriptCache();
    const cachedStr = cache.get('query_rows_' + userId);
    if (cachedStr) {
      const mapping = JSON.parse(cachedStr);
      if (mapping && mapping[indexNum]) {
        targetRow = mapping[indexNum];
      }
    }
  } catch (e) {}

  // 2. 若無快取，動態計算本月行號
  if (!targetRow) {
    const now = new Date();
    const currentMonth = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM');
    const data = detailSheet.getRange(2, 5, lastRow - 1, 1).getValues();
    const monthRows = [];
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim().startsWith(currentMonth)) {
        monthRows.push(i + 2);
      }
    }
    const recentRows = monthRows.slice(-10);
    if (indexNum >= 1 && indexNum <= recentRows.length) {
      targetRow = recentRows[indexNum - 1];
    }
  }

  if (!targetRow || targetRow > detailSheet.getLastRow()) {
    return { success: false, message: `找不到編號 [${indexNum}] 的紀錄。\n請先輸入「查詢」查看最新編號！` };
  }

  const rowValues = detailSheet.getRange(targetRow, 1, 1, 5).getValues()[0];
  let currentItem = rowValues[1];
  let currentCategory = rowValues[2];
  let currentAmount = Number(rowValues[3]) || 0;
  const monthStr = String(rowValues[4] || '').trim();

  let changeLog = [];

  // 判斷修改欄位：
  // 1. 金額修改（例：金額 150、價格 200、$250、250）
  const amountMatch = modContent.match(/(?:金額|價格|\$)?\s*(\d+)/);
  if (amountMatch && (modContent.includes('金額') || modContent.includes('價格') || modContent.includes('$') || /^\d+$/.test(modContent))) {
    const newAmount = Number(amountMatch[1]);
    const diff = newAmount - currentAmount;
    detailSheet.getRange(targetRow, 4).setValue(newAmount).setNumberFormat("#,##0");
    if (diff !== 0 && monthStr) {
      syncMonthlySummary(ss, monthStr, diff);
    }
    changeLog.push(`金額：${currentAmount.toLocaleString()} ➜ ${newAmount.toLocaleString()} 元`);
    currentAmount = newAmount;
  }

  // 2. 項目修改（例：項目 威力彩、品名 大樂透）
  const itemMatch = modContent.match(/(?:項目|品名|名稱)\s*(.+)/);
  if (itemMatch) {
    const newItem = itemMatch[1].trim();
    detailSheet.getRange(targetRow, 2).setValue(newItem);
    changeLog.push(`項目：${currentItem} ➜ ${newItem}`);
    currentItem = newItem;
  }

  // 3. 分類修改（例：分類 生活）
  const catMatch = modContent.match(/(?:分類|類別)\s*(.+)/);
  if (catMatch) {
    let newCat = catMatch[1].trim();
    if (VALID_CATEGORIES.includes(newCat)) {
      detailSheet.getRange(targetRow, 3).setValue(newCat);
      changeLog.push(`分類：${currentCategory} ➜ ${newCat}`);
      currentCategory = newCat;
    } else {
      changeLog.push(`⚠️ 分類「${newCat}」不在七大分類中，未修改分類`);
    }
  }

  if (changeLog.length === 0) {
    return {
      success: false,
      message: `❓ 無法辨識修改內容。\n指令範例：\n• 改 ${indexNum} 金額 150\n• 改 ${indexNum} 項目 威力彩\n• 改 ${indexNum} 分類 娛樂`
    };
  }

  return {
    success: true,
    message: `✏️ 已成功修改第 [${indexNum}] 筆紀錄！\n${changeLog.join('\n')}\n\n目前該筆狀態：${currentItem} | $${currentAmount.toLocaleString()} | ${currentCategory}`
  };
}

// ==============================================================================
// 8. Google 試算表寫入與月度統計更新
// ==============================================================================
function writeToSheet(item, category, amount) {
  const ss = getSpreadsheet();
  const detailSheet = ss.getSheetByName('記帳明細') || ss.getSheets()[0];

  const now = new Date();
  const monthStr = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM');

  detailSheet.appendRow([now, item, category, Number(amount), monthStr]);

  const lastRow = detailSheet.getLastRow();

  // A 欄（時間）：設定格式為「yyyy/M/d 上午/下午 hh:mm:ss」（自動靠右對齊）
  detailSheet.getRange(lastRow, 1).setNumberFormat("yyyy/M/d am/pm h:mm:ss");

  // D 欄（金額）：設定千分位數字格式（自動靠右對齊）
  detailSheet.getRange(lastRow, 4).setNumberFormat("#,##0");

  // E 欄（月份）：設定純文字並「強制靠右對齊」
  detailSheet.getRange(lastRow, 5).setNumberFormat("@").setHorizontalAlignment("right");

  // 同步累加至「月度彙總」工作表
  try {
    syncMonthlySummary(ss, monthStr, Number(amount));
  } catch (summaryErr) {
    Logger.log('⚠️ 同步月度彙總警示: ' + summaryErr.message);
  }

  return { month: monthStr };
}

/**
 * 刪除最後一筆紀錄核心函式
 */
function deleteLastRecord() {
  const ss = getSpreadsheet();
  const detailSheet = ss.getSheetByName('記帳明細') || ss.getSheets()[0];
  const lastRow = detailSheet.getLastRow();

  if (lastRow <= 1) {
    return { success: false, message: '目前沒有任何明細紀錄可供刪除。' };
  }

  const rowValues = detailSheet.getRange(lastRow, 1, 1, 5).getValues()[0];
  const item = rowValues[1];
  const category = rowValues[2];
  const amount = Number(rowValues[3]) || 0;
  const monthStr = String(rowValues[4] || '').trim();

  // 1. 刪除記帳明細最後一列
  detailSheet.deleteRow(lastRow);

  // 2. 同步從「月度彙總」扣回金額
  if (monthStr && amount > 0) {
    deductMonthlySummary(ss, monthStr, amount);
  }

  return {
    success: true,
    item: item,
    category: category,
    amount: amount
  };
}

/**
 * 同步累加更新「月度彙總」工作表
 */
function syncMonthlySummary(ss, monthStr, amount) {
  const summarySheet = ss.getSheetByName('月度彙總');
  if (!summarySheet) return;

  const data = summarySheet.getDataRange().getValues();
  let found = false;

  for (let i = 1; i < data.length; i++) {
    const rowMonth = String(data[i][0]).trim();
    if (rowMonth === monthStr || rowMonth.startsWith(monthStr)) {
      const currentVal = Number(data[i][1]) || 0;
      summarySheet.getRange(i + 1, 2).setValue(currentVal + amount);
      summarySheet.getRange(i + 1, 2).setNumberFormat("#,##0");
      found = true;
      break;
    }
  }

  if (!found) {
    summarySheet.appendRow([monthStr, amount]);
    const newRow = summarySheet.getLastRow();
    summarySheet.getRange(newRow, 1).setNumberFormat("@").setHorizontalAlignment("right");
    summarySheet.getRange(newRow, 2).setNumberFormat("#,##0");
  }
}

/**
 * 同步扣除更新「月度彙總」工作表
 */
function deductMonthlySummary(ss, monthStr, amount) {
  const summarySheet = ss.getSheetByName('月度彙總');
  if (!summarySheet) return;

  const data = summarySheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const rowMonth = String(data[i][0]).trim();
    if (rowMonth === monthStr || rowMonth.startsWith(monthStr)) {
      const currentVal = Number(data[i][1]) || 0;
      const newVal = Math.max(0, currentVal - amount);
      summarySheet.getRange(i + 1, 2).setValue(newVal);
      summarySheet.getRange(i + 1, 2).setNumberFormat("#,##0");
      break;
    }
  }
}

// ==============================================================================
// 9. LINE 訊息回覆模組
// ==============================================================================
function replyToLine(replyToken, messageText) {
  const token = CONFIG.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token || token.startsWith('YOUR_') || token.startsWith('請填入')) {
    Logger.log('⚠️ 未設定 LINE_CHANNEL_ACCESS_TOKEN，跳過 LINE 回覆');
    return;
  }

  const url = 'https://api.line.me/v2/bot/message/reply';
  const payload = {
    replyToken: replyToken,
    messages: [
      {
        type: 'text',
        text: messageText
      }
    ]
  };

  try {
    UrlFetchApp.fetch(url, {
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Authorization': 'Bearer ' + token
      },
      method: 'post',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log('❌ LINE 回覆訊息失敗: ' + e.message);
  }
}

// ==============================================================================
// 10. 前端儀表板 API 介面 (doGet - 免 Token 驗證版)
// ==============================================================================
function doGet(e) {
  try {
    const ss = getSpreadsheet();

    // 1. 讀取「記帳明細」
    const detailSheet = ss.getSheetByName('記帳明細') || ss.getSheets()[0];
    const details = detailSheet ? detailSheet.getDataRange().getDisplayValues() : [];

    // 2. 讀取「月度彙總」
    const summarySheet = ss.getSheetByName('月度彙總');
    const summary = summarySheet ? summarySheet.getDataRange().getDisplayValues() : [];

    const result = {
      status: 'success',
      details: details,
      summary: summary,
      updatedAt: Utilities.formatDate(new Date(), 'Asia/Taipei', "yyyy-MM-dd'T'HH:mm:ssXXX")
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: '讀取試算表資料失敗: ' + error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
