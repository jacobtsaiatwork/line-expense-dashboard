# 🤖 line-expense-dashboard | 記帳本 PRO

> **LINE 智慧個人記帳助理 + Google Gemini 多模態 AI + Google Sheets 雲端資料庫 + Cloudflare 前端視覺化儀表板**

[![LINE Messaging API](https://img.shields.io/badge/LINE-Messaging%20API-00B900?logo=line&logoColor=white)](https://developers.line.biz/)
[![Google Gemini](https://img.shields.io/badge/Google%20Gemini-Multimodal%20AI-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![Google Apps Script](https://img.shields.io/badge/Google-Apps%20Script-4285F4?logo=google&logoColor=white)](https://script.google.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS%203-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Chart.js](https://img.shields.io/badge/Chart.js-Data%20Visualization-FF6384?logo=chartdotjs&logoColor=white)](https://www.chartjs.org/)

---

## 🌟 專案簡介 (Overview)

**line-expense-dashboard** 是一個完全無伺服器（Serverless）、零主機營運成本的個人智慧記帳系統。

日常記帳最困難的就是「堅持」。本專案透過每個人每天都在使用的 **LINE 官方帳號** 作為輸入入口，整合 **Google Gemini 3.5** 頂尖多模態視覺與語言模型：
- 💬 **文字自然語言**：隨手輸入「排骨便當 120」或「搭 Uber 到北車 280」，AI 自動辨識品名、消費金額與標準分類。
- 📸 **拍照視覺記帳（模式二：多品項自動拆分）**：隨手拍下 **統一發票證明聯、QR Code、店家明細收據、超商便當、飲料杯貼紙或彩券**：
  - AI 自動辨識文字並解析電子發票 QR Code 中的各品項資訊。
  - **模式二自動拆分入帳**：若單張發票或收據包含多個品項，AI 會自動拆分成多筆獨立明細依序寫入試算表，不再只記一筆模糊的「總額」！
  - 自動套用超商「友善食光 7 折」或「i 珍食 65 折」折算。
- 🔍 **LINE 互動式查帳與修帳**：
  - 輸入 `查詢` 即時列出當月最近 10 筆帳目與流水編號。
  - 輸入 `刪除 3` 或 `刪除`，精準刪除指定項目並同步扣除「月度彙總」。
  - 輸入 `改 3 金額 150` 或 `改 2 項目 排骨便當`，靈活修改紀錄並即時連動月度報表。
- 📊 **雲端自動化彙總**：即時寫入 Google 試算表，自動轉換為標準日期格式與千分位數值，並同步累加「月度彙總」。
- 📈 **現代化視覺儀表板**：部署於 **Cloudflare Pages** 的單頁 SPA 前端儀表板（`index.html`），免 Token 直讀試算表 API，提供精緻圖表、月度趨勢、支出圓餅圖與明細檢視。

---

## 🏗️ 系統架構圖 (Architecture)

```mermaid
flowchart LR
    subgraph Client [使用者端]
        U[手機 LINE App]
    end

    subgraph Messaging [LINE 平台]
        L[LINE Official Account / Messaging API]
    end

    subgraph Backend [Google Apps Script 雲端微服務]
        GAS[Google Apps Script - Web App]
        Cache[(CacheService\n防重試去重機制)]
        Gemini[Google Gemini 2.5 API\nFlash-Lite / Flash 備援鏈]
    end

    subgraph Storage [雲端資料庫]
        Sheets[(Google Sheets\n「記帳明細」+「月度彙總」)]
    end

    subgraph Frontend [前端數據儀表板]
        CF[Cloudflare Pages\nindex.html + Tailwind + Chart.js]
    end

    U -->|傳送文字 / 照片| L
    L -->|Webhook POST 事件| GAS
    GAS <--> Cache
    GAS -->|下載照片二進位檔| L
    GAS -->|文字/照片 Prompt (Base64)| Gemini
    Gemini -->|回傳結構化 JSON| GAS
    GAS -->|原生真日期與金額寫入| Sheets
    GAS -->|4行簡潔回覆確認| L
    L -->|即時推播通知| U

    CF -->|HTTP GET (免驗證)| GAS
    GAS -->|讀取即時數據 JSON| Sheets
    GAS -.->|回傳最新統計數據| CF
```

---

## ✨ 核心特色 (Key Features)

1. **雙模態智能記帳 (Dual-Mode Tracking) + 模式二多品項自動拆分**
   - **自然語言辨識**：口語化輸入即可解析，保留使用者字眼精髓，不擅自添加「消費、花費」等贅字。
   - **拍照即記帳（模式二支援）**：
     - **電子發票與 QR Code 明細拆分**：自動解析電子發票證明聯上的 QR Code 或明細列表，將每個單品獨立寫入試算表（例如：買了 3 樣東西，自動產生 3 筆明細，各自對應所屬分類）。
     - **超商便當/生鮮商品**：辨識包裝貼紙上的品名與售價，自動套用「友善食光 / i 珍食」等折扣。
     - **單品/多品智能切換**：若單一商品（如飲料杯貼紙或彩券），自動記為單筆；若為多品項明細，自動拆開多筆。
2. **LINE 即時查帳、刪除與動態修改**
   - 隨時輸入 `查詢`，快速檢視當月明細編號。
   - 誤記或重複記帳時，輸入 `刪除 3` 精確刪除，或輸入 `改 3 金額 120` 即時更正，後台自動平帳更新「月度彙總」。
3. **最新極速模型備援鏈 (Resilient Fallback Chain)**
   - 採用 Google 官方最新、性價比與速度極佳的 `gemini-3.5-flash-lite`（搭配 low-thinking 零延遲模式），並以 `gemini-3.5-flash` 為備援，1~3 秒秒級解析回覆。
4. **健全的雲端機制**
   - **去重防呆**：利用 GAS `CacheService` 建立 60 秒事件去重快取，避免 LINE 伺服器重試導致重複入帳。
   - **真日期格式**：寫入原生 Date 物件至試算表，自動套用 `yyyy/M/d am/pm h:mm:ss` 靠右對齊格式，月度欄位強制靠右。
5. **極致美型儀表板 (Dashboard)**
   - 採用 Tailwind CSS、Chart.js 與 Lucide 圖標打造高質感深色/淺色個人財務儀表板。
   - 支援側邊欄自適應收合、月度篩選、類別支出環狀圖、月度支出柱狀圖與即時明細檢視。

---

## 🏷️ 七大分類規範 (Categories)

| 分類名稱 | 適用範圍說明 |
| :--- | :--- |
| 🍔 **餐飲** | 正餐、午餐、便當、超商熟食、全家/7-11飲料點心、早餐、手搖飲、小吃餐廳 |
| 🛒 **生活** | 超市買菜、食材、生鮮、全聯、水電瓦斯、日用衛生紙等生活消耗品 |
| 🏠 **家用** | 房租、家具、大型耗材、裝潢修繕、家電器材 |
| 🎁 **社交** | 朋友聚餐、請客、送禮、紅白包、派對、酒吧 |
| 🎮 **娛樂** | 電影、遊戲課金、Netflix / Spotify 訂閱、旅遊玩樂、非必要休閒 |
| 🚗 **交通** | 捷運、公車、計程車、Uber、高鐵、台鐵火車、加油、汽機車保養、停車費、悠遊卡加值 |
| 💊 **雜支** | 診所看診掛號費、藥局藥品、無法歸類之臨時偶發支出 |

---

## 🚀 完整部屬與安裝教學 (Step-by-Step Setup Guide)

### 步驟 1：建立 Google 試算表 (Google Sheets)
1. 前往 [Google 雲端硬碟](https://drive.google.com/)，新增一份 Google 試算表。
2. 建立以下兩個工作表（名稱需完全一致）：
   - **工作表一：`記帳明細`**
     - 第一列標題：`時間` | `項目` | `分類` | `金額` | `月份`
   - **工作表二：`月度彙總`**
     - 第一列標題：`月份` | `總支出`

---

### 步驟 2：建立 Google Apps Script 後端
1. 在試算表上方選單點選 **「擴充功能」 > 「Apps Script」**。
2. 將本專案中的 [`Code.gs`](./Code.gs) 內容完整複製並貼上，取代編輯器內的預設程式碼。
3. 設定機密環境變數：
   - 點選左側齒輪圖示 **「專案設定 (Project Settings)」**。
   - 滑到下方 **「指令碼屬性 (Script Properties)」**，新增三組屬性：
     - `LINE_CHANNEL_ACCESS_TOKEN`：你的 LINE Messaging API Channel access token。
     - `GEMINI_API_KEY`：在 [Google AI Studio](https://aistudio.google.com/) 取得的免費 API Key。
     - `SPREADSHEET_ID`：若此 Apps Script 直接由試算表建立，可留空；若是獨立專案，請填入試算表網址中的 ID。
4. 儲存專案（`Ctrl + S` 或 `Cmd + S`）。

---

### 步驟 3：部署 Web 應用程式 (Web App)
1. 點擊右上角 **「部署」 > 「新增部署作業」**。
2. 點選齒輪選擇類型為 **「網頁應用程式 (Web app)」**：
   - **說明**：`v1.0.0 雙模態智慧記帳`
   - **執行身分**：`我 (你的 Google 帳號)`
   - **誰可以存取**：`所有人 (Anyone)` *(注意：必須為所有人，LINE Webhook 與 Cloudflare 前端才能調用)*
3. 點擊「部署」，授權 Google 帳號相關存取權限。
4. 部署成功後，會取得一組 **網頁應用程式網址 (Web App URL)**（格式如：`https://script.google.com/macros/s/AKfycb.../exec`）。

> [!TIP]
> **更新程式碼注意事項**：日後若修改 `Code.gs`，請務必點選 **「部署」 > 「管理部署作業」 > 編輯（鉛筆） > 版本選「建立新版本」 > 部署**，變更才會生效！

---

### 步驟 4：設定 LINE Messaging API Webhook
1. 登入 [LINE Developers Console](https://developers.line.biz/)。
2. 進入你的 Messaging API Channel：
   - 找到 **Webhook URL**，貼上剛才步驟 3 取得的 **GAS 網頁應用程式網址**。
   - 開啟 **Use webhook** 開關。
   - 點擊 **Verify**，確認回傳 `Success`。
   - 在下方將 **Auto-reply messages (自動回覆訊息)** 關閉，避免官方預設罐頭訊息干擾。

---

### 步驟 5：部署前端儀表板 (Cloudflare Pages)
本專案的 [`index.html`](./index.html) 是純靜態前端，最推薦部署在免費、速度極快的 **Cloudflare Pages**：
1. 登入 [Cloudflare Dashboard](https://dash.cloudflare.com/)，進入 **Workers & Pages**。
2. 選擇 **Create application** > **Pages** > **Connect to Git**。
3. 綁定此 GitHub 專案 `line-expense-dashboard`。
4. 建置設定（Build Settings）：
   - **Framework preset**：`None`
   - **Build command**：留空
   - **Build output directory**：`./`
5. 點擊 **Save and Deploy**，數秒後即可獲得全球 CDN 加速的專屬儀表板網址！
6. 開啟儀表板後，點選左側選單的 **「雲端連線設定」**，貼上步驟 3 的 **GAS Web App URL**，即可自動同步呈現試算表內的所有帳目數據！

---

## 💬 使用方式範例 (Usage Examples)

### 1. 傳送文字訊息
在 LINE 對話框中像平常傳訊息一樣：
* `午餐牛肉麵 160` ➜ 項目：牛肉麵 | 金額：160 | 分類：餐飲
* `搭計程車去高鐵 320` ➜ 項目：搭計程車 | 金額：320 | 分類：交通
* `好市多買菜 1850` ➜ 項目：好市多 | 金額：1850 | 分類：生活
* `全聯抽取式衛生紙 239` ➜ 項目：全聯抽取式衛生紙 | 金額：239 | 分類：生活

### 2. 拍照上傳照片（模式二：多品項自動拆分入帳）
直接在 LINE 對話框點選相機拍照或相簿上傳：
* 📸 **電子發票證明聯 / 含有 QR Code 之收據** ➜ 自動讀取 QR Code 與發票文字，並將購買的各個品項**自動拆開成多列明細**寫入試算表！
  > 例如拍一張 7-ELEVEN 發票（內含茶葉蛋 14 元、拿鐵 55 元、御飯糰 35 元）：
  > AI 會自動拆分為 3 筆入帳，分別歸類為「餐飲」，總共寫入 3 列。
* 📸 **超商便當 / 熟食包裝** ➜ 自動辨識「奮起湖便當」、抓取售價、歸類「餐飲」，若有「友善食光 7 折」或「i 珍食 65 折」貼紙會自動折算入帳。
* 📸 **台灣彩券（大樂透 / 威力彩 / 今彩539）** ➜ 自動辨識彩券名稱、期數與總投注金額，歸類為「娛樂」。
* 📸 **飲料杯貼紙 / 單品標籤** ➜ 自動辨識飲料品名與實付金額，精準記帳。

### 3. LINE 查帳、刪除與修改指令
在對話框中直接輸入以下關鍵字：
* 🔍 **查詢本月明細**：
  - 輸入：`查詢` 或 `查帳`
  - 回覆：列出當月最近 10 筆紀錄與編號（如 `#1`、`#2`、`#3`...），方便核對。
* 🗑️ **刪除錯誤紀錄**：
  - 輸入：`刪除 3` ➜ 刪除編號 `#3` 那一筆紀錄，並自動自「月度彙總」中扣除該筆金額。
  - 輸入：`刪除` ➜ 預設刪除最後一筆紀錄。
* ✏️ **修改特定紀錄**：
  - 輸入：`改 3 金額 150` ➜ 將編號 `#3` 的金額改為 150，自動重新平帳計算「月度彙總」。
  - 輸入：`改 2 項目 排骨便當` ➜ 將編號 `#2` 的品名改為「排骨便當」。
  - 輸入：`改 1 分類 生活` ➜ 將編號 `#1` 的分類改為「生活」。
* 💰 **設定每月預算上限**：
  - 輸入：`預算 20000` 或 `設定預算 25000` ➜ 自動將每月預算上限儲存至雲端，網頁儀表板與剩餘額度即刻同步，跨裝置永久保存！

---

## 📂 專案目錄結構 (Project Structure)

```text
line-expense-dashboard/
├── Code.gs         # Google Apps Script 核心後端腳本 (LINE Webhook + Gemini Vision + Sheets API)
├── index.html      # 現代化財務數據分析儀表板 (SPA 前端，適用 Cloudflare Pages)
└── README.md       # 專案詳細說明與架構部署手冊
```

---

## 🛠️ 常見問題與除錯 (FAQ & Troubleshooting)

<details>
<summary><b>Q1: 傳送照片後 LINE 顯示無法辨識？</b></summary>
1. 確保拍照時避免強烈的反光吃掉文字（尤其是超商便當的透明封膜）。<br/>
2. 確保照片中包含關鍵字樣（如：售價、金額、TOTAL、總計、店名）。<br/>
3. 檢查 GAS 執行記錄（Executions），確認 GEMINI_API_KEY 與 LINE_CHANNEL_ACCESS_TOKEN 是否正確設定。
</details>

<details>
<summary><b>Q2: 修改了 Code.gs 但功能沒有更新？</b></summary>
每次修改 Google Apps Script 後，<b>必須點擊「部署」>「管理部署作業」>「編輯（鉛筆圖示）」> 版本選「建立新版本」>「部署」</b>。若沒有建立新版本，LINE 的 Webhook 就會一直呼叫舊代碼。
</details>

<details>
<summary><b>Q3: LINE 偶爾會收到兩次回覆？</b></summary>
程式內建了 60 秒的 <code>CacheService</code> 去重快取。如果網路延遲過高導致 LINE 伺服器重試，去重機制會直接擋下重複的事件，確保試算表不會重複記帳。
</details>

---

## 📄 授權條款 (License)

本專案採用 [MIT License](https://opensource.org/licenses/MIT) 授權開放使用。歡迎自由 Fork、客製化修改及個人非商業/商業應用！
