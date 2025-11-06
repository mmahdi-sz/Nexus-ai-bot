<div align="center">

# 🧠 Nexus AI - Advanced Multipurpose Telegram Bot

**[فارسی / Persian](./README.fa.md)**

<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
<img src="https://img.shields.com/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" />
<img src="https://img.shields.com/badge/Google_Gemini-8E75B2?style=for-the-badge&logo=googlegemini&logoColor=white" />
<img src="https://img.shields.io/badge/Architecture-00599C?style=for-the-badge&logo=databricks&logoColor=white" />

**The core hub for advanced AI functionalities, featuring enterprise-grade Key Pooling, Group Moderation, and a robust Admin Panel.**

</div>

---

## ✨ Core Features

Nexus AI serves as a central hub for multiple sophisticated features, built on a secure and high-performance architecture.

### 🔑 Enterprise AI Key Management
- **Key Pool System**: Dynamically load-balances requests across multiple Gemini API keys for maximum availability and high throughput.
- **Secure Key Donation**: Users can securely contribute their own keys via a wizard, instantly receiving premium status with unlimited usage.
- **Data Security**: All API keys are encrypted using **AES-256-GCM** before database storage, ensuring zero plaintext exposure.
- **Usage & Cooldown**: Automated monitoring of request/token usage per key, with enforced cooldowns for rate-limited keys.

### 🛡️ Group Guard & Moderation
- **Multilingual Moderation**: Group Admins can use simple Persian/English commands (e.g., `بن/ban`, `سکوت/mute`, `کیک/kick`) for immediate group management.
- **Smart Target Detection**: Supports replying, mentioning, or using a user ID for all moderation commands.
- **Tiered Usage Limits**: Non-premium users are subject to daily, weekly, and monthly message limits for AI interactions.

### 🧠 AI Core & Utility
- **Contextual Memory**: Maintains both short-term (conversation) and long-term (summary) memory for highly relevant and consistent AI interactions.
- **Future Utility Features**: The architecture is designed to easily integrate advanced utility features like **GIF Generation**, **First Comment Bot**, and other creative tools.
- **Real-time Prompt Editor**: The owner can instantly modify the AI's core persona and rules via the Admin Panel.

### 📊 Comprehensive Admin Panel (Owner-Only)
Accessible via the `/start` command in a private chat with the owner.
- **Live Editing**: Change AI prompts and user-facing texts instantly.
- **Broadcast System**: Send global messages (text, media, forward, pin) to all active users and groups.
- **Statistics Dashboard**: Real-time metrics on users, groups, and API consumption.

---

## 🏗️ Technical Architecture

### Project Structure Highlights
The architecture separates core logic, database interactions, event handlers, and admin functions:
- `core/`: Main conversation and Gemini API logic.
- `database/`: Repository pattern for secure and reliable MariaDB interaction.
- `keyPoolManager.js`: Handles key selection, leasing, and encryption/decryption.

### Tech Stack

| Component | Technology |
| :--- | :--- |
| **Runtime** | Node.js 18+ |
| **Bot Framework** | `node-telegram-bot-api` |
| **AI Provider** | Google Gemini API (`@google/genai`) |
| **Database** | MariaDB 10.6+ |
| **Encryption** | AES-256-GCM (Node.js crypto) |

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js v18 or higher
- MariaDB/MySQL 10.6+
- Telegram Bot Token
- Gemini API Key

### Configuration Steps
1.  **Clone the Repository & Install Dependencies:**
    ```bash
    git clone https://github.com/yourusername/nexus-ai-bot.git
    cd nexus-ai-bot
    npm install
    ```

2.  **Configure Environment (`.env`):**
    Create a `.env` file from `env.example` and populate the following critical variables:

| Variable | Description | Notes |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Your BotFather Token. | Required. |
| `BOT_OWNER_ID` | Your numeric Telegram User ID. | Required for Admin Panel access. |
| `ENCRYPTION_KEY` | 64-character Hex String. | Generated once for AES-256-GCM key security. |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Database connection details. | Ensure your MariaDB/MySQL instance is running. |

3.  **Run the Bot:**
    ```bash
    # Development
    node bot.js

    # Production (with PM2)
    pm2 start bot.js --name nexus-ai
    ```

---

## 📜 User Commands

| Command | Description | Notes |
| :--- | :--- | :--- |
| `/start` | Initializes chat; opens Admin Panel for the owner. | |
| `/new` | Resets the current conversation history (short-term memory). | |
| `/status` | Views current message usage limits and premium status. | |
| `/donate` | Initiates the API Key Donation Wizard. | Grants unlimited usage. |
| `/enable` | Activates the bot in a group chat. | Group Admins only. |

---

<div align="center">

**⭐ If you find this project useful, please give it a star! ⭐**

</div>