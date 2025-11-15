# Kolt - KOL Tracker for Pump.fun

**Kolt** is a sophisticated real-time tracking system for Key Opinion Leaders (KOLs) and traders on **Pump.fun**. It monitors trading activity on Pump.fun's automated market maker (AMM), identifies top-performing traders, tracks their P&L in real-time, and sends live alerts via Telegram whenever tracked traders execute trades.

## Features

### 🎯 Core Functionality

- **Real-time Trade Monitoring**: Connects to Pump.fun's WebSocket API to capture buy/sell events instantly
- **Multi-Tier Trader Analysis**: Tracks traders across multiple token pools with sophisticated P&L calculations
- **Live P&L Tracking**: Calculates both realized and unrealized profit/loss using FIFO lot tracking
- **Automated Source Discovery**: Automatically identifies and adds top holders when tokens migrate from Pump.fun to Raydium
- **Trader Tiering System**: Classifies traders as Tier A (elite), B (mid-level), or C (emerging) based on performance
- **Telegram Bot Integration**: Live notifications for tracked trader activity with detailed trade metrics
- **Memory-Efficient Garbage Collection**: Automatically cleans up inactive traders while preserving manually added wallets
- **Leaderboard System**: Ranks traders by total P&L performance

### 🔧 Engine Architecture

Kolt uses a modular engine-based architecture with four main processing engines:

#### 1. **MainEngine** (`src/engine/main.ts`)
- Core trading logic and P&L management
- Maintains an in-memory database of traders and their pools
- Implements FIFO lot tracking for accurate PnL calculations
- Handles trader tiering based on performance
- Implements memory cap enforcement with garbage collection
- Runs periodic cleanup with tier-based inactivity timeouts

#### 2. **PumpswapEngine** (`src/engine/pumpswap.ts`)
- Connects to Pump.fun's NATS WebSocket server for real-time trade events
- Subscribes to `ammTradeEvent` streams
- Parses and processes buy/sell events
- Calculates token prices and market caps
- Routes trades to MainEngine and TrackerEngine
- Manages automatic reconnection with exponential backoff

#### 3. **TrackerEngine** (`src/engine/tracker.ts`)
- Maintains a list of manually added and auto-discovered top traders
- Periodically syncs top performers from MainEngine
- Sends Telegram notifications for tracked trader activity
- Implements separate garbage collection for non-manually-added traders
- Tracks buy/sell counts and activity timestamps for each trader
- Respects a configurable maximum number of automatically tracked traders

#### 4. **SourceEngine** (`src/engine/source.ts`)
- Listens for token migrations from Pump.fun to Raydium
- Fetches top token holders when new tokens graduate
- Automatically adds top holders to the MainEngine for monitoring
- Sends failure notifications via Telegram when sourcing issues occur

#### 5. **TelegramEngine** (`src/engine/telegram.ts`)
- Provides interactive Telegram bot interface
- Supports commands: `/start`, `/status`, `/tracker`
- Allows manual wallet addition via address submission
- Displays live statistics for all engines
- Implements rate limiting (30 messages/sec globally, 1 per chat per sec)
- Shows live trade alerts for tracked traders with detailed metrics
- Supports message deletion and interactive UI refreshes

## Architecture Overview

```
┌─────────────────────────────────────────┐
│      Pump.fun WebSocket (Real-time)     │
└──────────────┬──────────────────────────┘
               │
               ▼
        ┌──────────────┐
        │SourceEngine  │ ◄── Token Migrations
        └──────┬───────┘
               │
        ┌──────▼──────────┐
        │ PumpswapEngine   │ ◄── Trade Events
        └──────┬──────────┘
               │
        ┌──────▼────────────────────────┐
        │      Trade Router             │
        └──────┬─────────────┬──────────┘
               │             │
         ┌─────▼────┐  ┌─────▼────────┐
         │ MainEngine│  │TrackerEngine │
         │(All      │  │(Tracked      │
         │Traders)  │  │Traders Only) │
         └──────────┘  └─────┬────────┘
                              │
                        ┌─────▼─────────┐
                        │TelegramEngine  │
                        │(Notifications) │
                        └────────────────┘
```

## Data Models

### Trader Model (`src/model/main.ts`)
```typescript
interface Trader {
  pools: Record<PoolAddress, TraderPool>;
  lastActive: number;
  tier: "A" | "B" | "C";  // Performance-based classification
}

interface TraderPool {
  lots: TraderPoolLot[];           // FIFO lot tracking
  realizedPnL: number;              // Gains from completed sales
  unrealizedPnL: number;            // Theoretical gains from holdings
  totalBuys: number;                // Total SOL spent buying
  totalSells: number;               // Total SOL received selling
  currentHoldings: number;          // Current token balance
  lastActive: number;               // Last trade timestamp
  badScore: number;                 // Losing streak counter
  lastPriceSol: number;             // Most recent token price
}
```

### Tracked Trader Model (`src/model/tracker.ts`)
```typescript
interface TrackedTrader {
  timeAdded: number;        // When tracking started
  lastUpdated: number;      // Last activity
  sells: number;
  buys: number;
  manuallyAdded: boolean;   // Protected from garbage collection
  pnl?: number;             // Cached P&L from MainEngine
  upnl?: number;            // Cached unrealized P&L
  rpnl?: number;            // Cached realized P&L
}
```

## Configuration

Kolt is configured via environment variables (`.env` file). All available configuration options are documented in the [`.env.sample`](./.env.sample) file with detailed comments explaining each setting.

To get started:
1. Copy `.env.sample` to `.env`
2. Edit `.env` with your actual values
3. **Never commit `.env` with sensitive data to version control**

### Quick Reference

For a complete list of all configuration variables with full explanations, see [`.env.sample`](./.env.sample). Below is a quick reference of key sections:

### Server Settings
```env
TITLE=Kolt                          # Application title
PORT=3000                           # HTTP server port
PRODUCTION=false                    # Production mode flag
FORCE_FAMILY_4=false               # Force IPv4 connections
EXIT_ON_UNCAUGHT_EXCEPTION=true    # Exit on unhandled errors
EXIT_ON_UNHANDLED_REJECTION=true   # Exit on promise rejections
```

### Solana & Blockchain
```env
RPC=https://api.mainnet-beta.solana.com  # Solana RPC endpoint
PF_API=https://frontend-api-v3.pump.fun  # Pump.fun API
PRIVATE_KEY=[...]                        # Solana keypair (for future features)
NETWORK_FEE=0.000005                     # Network fee in SOL
```

### Telegram Bot
```env
TG_TOKEN=<your_bot_token>               # Telegram bot API token
TG_CHAT_ID=<your_chat_id>              # Target chat for notifications
TG_POLLING=false                        # Use webhook instead of polling
TG_WH_SECRET_TOKEN=edqfwvrebwtn7f      # Webhook secret token
TG_BOT_URL=https://your.domain.com      # Webhook URL
```

### WebSocket Settings
```env
WS_URL=wss://pumpportal.fun/api/data    # Token migration WS
WS_RECON_DELYAY_MS=5000                 # Reconnection delay
```

### PumpSwap Engine (NATS Connection)
```env
PS_DEFAULT_DETAILS="username=... password=... server=..."
PS_RECONNECT_TIMEOUT_MS=0                # Reconnection timeout (auto-fetch if 0)
PS_MAX_RECON_RETRIES=5                   # Maximum reconnection attempts
PS_PF_TOTAL_SUPPLY=1000000000000000      # Token total supply (for price calc)
PS_RETRIES_INTERVAL_MS=5000              # Retry interval
```

### MainEngine Configuration
```env
MN_BAD_PNL_THRESHOLD=-0.2               # PnL threshold for bad trades (-20%)
MN_MAX_BAD_SCORE=3                      # Max consecutive losing trades
MN_MEMORY_CAP=5000                      # Max traders in memory
MN_INACTIVITY_TIMEOUT_MS=1800000        # 30 minutes default inactivity timeout
MN_GARBAGE_INTERVAL_MS=180000           # GC runs every 3 minutes
```

### TrackerEngine Configuration
```env
TR_INTERVAL_MS=180000                   # 3 minutes - sync interval with MainEngine
TR_MAX_TRADERS=30                       # Max auto-tracked traders (plus manually added)
TR_SEND_AUTO_ADD=true                   # Notify when top traders added
TR_SEND_AUTO_REM=true                   # Notify when traders removed
TR_SEND_ACTIVITY=true                   # Send live trade notifications
TR_INACTIVITY_TIMEOUT_MS=1800000        # 30 minutes - remove inactive tracked traders
```

> 📝 **For detailed descriptions and explanations of every variable, see [`.env.sample`](./.env.sample)**

## Installation & Setup

### Prerequisites
- Node.js >= 16.x
- npm or yarn
- A Telegram bot token (create via [@BotFather](https://t.me/botfather))
- Solana RPC endpoint (public or private)

### Steps

1. **Clone and Install**
```bash
git clone <repository>
cd koltdev
npm install
```

2. **Configure Environment**
Create a `.env` file in the root directory:
```bash
cp .env.sample .env
# Edit .env with your settings
```

3. **Build**
```bash
npm run build
```

4. **Run**

Development mode (with hot reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Health Check
```
GET /
Response: "Kolt is on."
```

### Telegram Webhook
```
POST /webhook
Headers: x-telegram-bot-api-secret-token: <TG_WH_SECRET_TOKEN>
Body: Telegram update JSON
```

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Display welcome message and instructions |
| `/status` | Show real-time statistics for all engines |
| `/tracker` | Display list of currently tracked wallets with controls |
| Send wallet address | Manually add a wallet to tracker |

### Status Display Shows:
- **Source Engine**: Tokens migrated, top traders added
- **Main Engine**: Total traders, removed traders
- **PumpSwap Engine**: Connection status, latency, message counts
- **Tracker Engine**: Auto-tracked, manually-tracked, removed traders

## How It Works

### Trade Flow
1. **Detection**: PumpswapEngine listens to Pump.fun's NATS server for `ammTradeEvent` messages
2. **Parsing**: Trade data is decoded and parsed (converting hex floats to decimals)
3. **Routing**: Trade is passed to both MainEngine and TrackerEngine
4. **MainEngine Processing**:
   - Updates trader pools with buy/sell data
   - Tracks lots using FIFO method for accurate PnL
   - Updates unrealized PnL based on current price
   - Recalculates trader tier
5. **TrackerEngine Processing**: 
   - If trader is tracked, sends Telegram notification
6. **Notification**: Tracked trades trigger Telegram messages with metrics

### P&L Calculation
- **Realized P&L**: Calculated when tokens are sold using FIFO lot matching
- **Unrealized P&L**: Current holdings × (Current Price - Average Cost)
- **Bad Score**: Incremented on losing trades, decremented on profitable trades
- **Tier System**: Based on total P&L
  - **Tier A** (>$10): 4× inactivity timeout (2 hours)
  - **Tier B** ($1-$10): 2× inactivity timeout (1 hour)
  - **Tier C** (<$1): Base timeout (30 minutes)

### Garbage Collection
- Runs every 3 minutes
- Removes traders exceeding memory cap (lowest P&L first)
- Removes inactive pools based on tier-multiplied timeout
- Removes stale traders with no active pools
- Preserves manually-added traders indefinitely

### Source Discovery
- Listens to migration events from Pump.fun → Raydium
- Fetches top 10 token holders (configurable)
- Automatically adds them to MainEngine for monitoring
- Sends error notifications if sourcing fails

## Performance Metrics

The system tracks:
- **Message Latency**: Time from event occurrence to message receipt (stored in rolling window)
- **Message Count**: Total messages processed
- **Valid Message Count**: Messages for tracked traders
- **Subscription Status**: Whether actively subscribed to trade events
- **Trader Count**: Current traders in memory
- **Deleted Traders**: Total removed via garbage collection

## Project Structure

```
src/
├── index.ts                 # Main entry point & Express server
├── site.ts                  # Configuration management
├── engine/
│   ├── main.ts             # MainEngine - core P&L tracking
│   ├── pumpswap.ts         # PumpswapEngine - NATS WebSocket
│   ├── tracker.ts          # TrackerEngine - tracked wallets
│   ├── source.ts           # SourceEngine - token migrations
│   ├── telegram.ts         # TelegramEngine - bot interface
│   └── terminal.ts         # Engine lifecycle management
├── lib/                    # Utility functions
│   ├── format_number.ts
│   ├── date_time.ts
│   ├── log.ts
│   ├── parse_hex_float.ts
│   ├── is_valid_address.ts
│   └── ... (other utilities)
└── model/
    ├── main.ts            # Trader & Pool interfaces
    └── tracker.ts         # TrackedTrader interface
```

## Logging

Kolt uses a custom logging system with weight-based filtering:
- **Weight 0**: Critical system events
- **Weight 1-2**: Major engine operations
- **Weight 3+**: Detailed operations (configurable with `MAX_ALLOWED_FLOG_LOG_WEIGHT`)

## Troubleshooting

### Connection Issues
- Check `PS_RECONNECT_TIMEOUT_MS` - if 0, credentials are auto-fetched from Pump.fun
- Verify RPC endpoint is accessible
- Check WebSocket URL for token migrations

### Missing Trades
- Verify `TG_POLLING` is set correctly
- Check webhook secret token matches Telegram settings
- Ensure trader is in MainEngine before it's tracked

### High Memory Usage
- Reduce `MN_MEMORY_CAP` to keep fewer traders in memory
- Lower `MN_INACTIVITY_TIMEOUT_MS` to remove inactive traders faster
- Reduce `TR_MAX_TRADERS` to track fewer traders

### Telegram Not Sending
- Verify `TG_TOKEN` and `TG_CHAT_ID` are correct
- Check rate limiting: max 30 msgs/sec globally, 1 per chat per sec
- Ensure bot has permission to send messages in chat

## Development

### Build & Run
```bash
# TypeScript compilation
npm run build

# Run dev with hot reload
npm run dev

# Run compiled version
npm start
```

### Tech Stack
- **Runtime**: Node.js with TypeScript
- **Blockchain**: @solana/web3.js
- **WebSocket**: ws, nats.ws
- **Telegram**: node-telegram-bot-api
- **API**: Express.js
- **Environment**: dotenv

## License

ISC

## Author

Built for tracking KOLs on Pump.fun

---

**Note**: This project is for monitoring purposes. Always ensure compliance with platform terms of service and local regulations when deploying.