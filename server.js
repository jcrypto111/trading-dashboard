/**
 * Trading Dashboard v2.0 - Render + Turso Edition
 * Free forever hosting with persistent database
 */

const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ type: 'text/plain', limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Turso Database
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:local.db',
  authToken: process.env.TURSO_AUTH_TOKEN
});

console.log('🚀 Trading Dashboard Server Starting...');

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

async function initDatabase() {
  const schema = `
    -- Symbols table
    CREATE TABLE IF NOT EXISTS symbols (
      symbol TEXT PRIMARY KEY,
      exchange TEXT,
      price REAL,
      open REAL,
      high REAL,
      low REAL,
      volume REAL,
      last_updated INTEGER,
      market_cap REAL,
      volume_24h REAL,
      price_change_1h REAL,
      price_change_24h REAL,
      price_change_7d REAL,
      change_vs_btc_24h REAL,
      change_vs_eth_24h REAL,
      volume_avg_24h REAL,
      volume_ratio REAL,
      in_watchlist INTEGER DEFAULT 0,
      has_data INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- MSS/BOS Data
    CREATE TABLE IF NOT EXISTS mssbos_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      exchange TEXT,
      price REAL,
      timestamp INTEGER,
      chart_tf TEXT,
      bull_count INTEGER,
      bear_count INTEGER,
      bias TEXT,
      confluence_strength INTEGER,
      tf_1m TEXT, tf_3m TEXT, tf_5m TEXT, tf_15m TEXT, tf_30m TEXT,
      tf_1h TEXT, tf_4h TEXT, tf_12h TEXT, tf_1d TEXT, tf_1w TEXT,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Momentum Data
    CREATE TABLE IF NOT EXISTS momentum_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      exchange TEXT,
      price REAL,
      timestamp INTEGER,
      timeframe TEXT,
      trend TEXT,
      last_structure TEXT,
      swing_high REAL,
      swing_low REAL,
      invalidation_level REAL,
      momentum_status TEXT,
      last_hh_percent REAL,
      last_ll_percent REAL,
      distribution_detected INTEGER,
      distribution_drives INTEGER,
      accumulation_detected INTEGER,
      accumulation_drives INTEGER,
      caution_count INTEGER,
      caution_timeframes TEXT,
      caution_1m INTEGER, caution_3m INTEGER, caution_5m INTEGER,
      caution_15m INTEGER, caution_30m INTEGER, caution_1h INTEGER,
      caution_4h INTEGER, caution_12h INTEGER, caution_1d INTEGER, caution_1w INTEGER,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Supply/Demand Data
    CREATE TABLE IF NOT EXISTS supplydemand_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      exchange TEXT,
      price REAL,
      timestamp INTEGER,
      chart_tf TEXT,
      in_demand_zone INTEGER,
      in_supply_zone INTEGER,
      has_demand_rejection INTEGER,
      has_supply_rejection INTEGER,
      demand_1m INTEGER, demand_3m INTEGER, demand_5m INTEGER,
      demand_15m INTEGER, demand_30m INTEGER, demand_1h INTEGER,
      demand_4h INTEGER, demand_12h INTEGER, demand_1d INTEGER, demand_1w INTEGER,
      supply_1m INTEGER, supply_3m INTEGER, supply_5m INTEGER,
      supply_15m INTEGER, supply_30m INTEGER, supply_1h INTEGER,
      supply_4h INTEGER, supply_12h INTEGER, supply_1d INTEGER, supply_1w INTEGER,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Multi-Algo Data
    CREATE TABLE IF NOT EXISTS multialgo_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      exchange TEXT,
      price REAL,
      timestamp INTEGER,
      timeframe TEXT,
      dots_green INTEGER,
      dots_red INTEGER,
      squares_green INTEGER,
      squares_red INTEGER,
      background_green INTEGER,
      background_red INTEGER,
      algo1_buy INTEGER, algo1_sell INTEGER,
      algo2_buy INTEGER, algo2_sell INTEGER,
      algo3_buy INTEGER, algo3_sell INTEGER,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Relative Strength Data
    CREATE TABLE IF NOT EXISTS relative_strength_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timestamp INTEGER,
      timeframe TEXT,
      rs_vs_btc REAL,
      rs_vs_eth REAL,
      rs_vs_total REAL,
      rs_rating TEXT,
      outperforming_btc INTEGER,
      outperforming_eth INTEGER,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Divergence Data
    CREATE TABLE IF NOT EXISTS divergence_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timestamp INTEGER,
      timeframe TEXT,
      divergence_type TEXT,
      indicator TEXT,
      direction TEXT,
      strength TEXT,
      price_at_signal REAL,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Volume Data
    CREATE TABLE IF NOT EXISTS volume_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      timestamp INTEGER,
      timeframe TEXT,
      volume REAL,
      volume_sma REAL,
      volume_ratio REAL,
      is_above_average INTEGER,
      volume_trend TEXT,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Recent Alerts
    CREATE TABLE IF NOT EXISTS recent_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      alert_category TEXT NOT NULL,
      direction TEXT,
      timeframe TEXT,
      price_at_alert REAL,
      message TEXT,
      importance TEXT DEFAULT 'normal',
      is_read INTEGER DEFAULT 0,
      show_in_panel INTEGER DEFAULT 1,
      timestamp INTEGER,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Signal History
    CREATE TABLE IF NOT EXISTS signal_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      indicator TEXT NOT NULL,
      direction TEXT NOT NULL,
      timeframe TEXT,
      price_at_signal REAL,
      current_price REAL,
      price_change_pct REAL,
      timestamp INTEGER,
      is_active INTEGER DEFAULT 1,
      outcome TEXT,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Trade Setups
    CREATE TABLE IF NOT EXISTS trade_setups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      setup_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL,
      current_price REAL,
      detected_at INTEGER,
      demand_zone_tf TEXT,
      supply_zone_tf TEXT,
      mssbos_signal TEXT,
      mssbos_tf TEXT,
      caution_count INTEGER,
      caution_tfs TEXT,
      algo_signals TEXT,
      has_circles INTEGER,
      has_squares INTEGER,
      has_divergence INTEGER,
      divergence_type TEXT,
      volume_confirmation INTEGER,
      rs_confirmation INTEGER,
      confluence_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      invalidated_at INTEGER,
      invalidation_reason TEXT,
      exit_price REAL,
      exit_timestamp INTEGER,
      pnl_percent REAL,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );

    -- Alert Settings
    CREATE TABLE IF NOT EXISTS alert_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_type TEXT UNIQUE NOT NULL,
      show_in_panel INTEGER DEFAULT 1,
      play_sound INTEGER DEFAULT 0,
      importance TEXT DEFAULT 'normal'
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_mssbos_symbol ON mssbos_data(symbol);
    CREATE INDEX IF NOT EXISTS idx_momentum_symbol ON momentum_data(symbol);
    CREATE INDEX IF NOT EXISTS idx_supplydemand_symbol ON supplydemand_data(symbol);
    CREATE INDEX IF NOT EXISTS idx_multialgo_symbol ON multialgo_data(symbol);
    CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON recent_alerts(timestamp);
    CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signal_history(symbol);
    CREATE INDEX IF NOT EXISTS idx_setups_status ON trade_setups(status);
  `;

  // Execute each statement separately
  const statements = schema.split(';').filter(s => s.trim());
  for (const stmt of statements) {
    if (stmt.trim()) {
      await db.execute(stmt);
    }
  }

  // Initialize default alert settings
  const alertTypes = [
    'DEMAND_ZONE_ENTRY', 'SUPPLY_ZONE_ENTRY', 'DEMAND_REJECTION', 'SUPPLY_REJECTION',
    'MSS_BULLISH', 'MSS_BEARISH', 'BOS_BULLISH', 'BOS_BEARISH',
    'CAUTION_SIGNAL', 'DISTRIBUTION', 'ACCUMULATION',
    'ALGO1_BUY', 'ALGO1_SELL', 'ALGO2_BUY', 'ALGO2_SELL', 'ALGO3_BUY', 'ALGO3_SELL',
    'DOTS_GREEN', 'DOTS_RED', 'SQUARES_GREEN', 'SQUARES_RED',
    'BULLISH_DIVERGENCE', 'BEARISH_DIVERGENCE', 'VOLUME_SPIKE', 'RS_OUTPERFORM',
    'LONG_SETUP', 'SHORT_SETUP'
  ];

  for (const alertType of alertTypes) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO alert_settings (alert_type, show_in_panel, importance) VALUES (?, 1, ?)',
      args: [alertType, alertType.includes('SETUP') || alertType.includes('REJECTION') ? 'high' : 'normal']
    });
  }

  console.log('✅ Database initialized');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function parseWebhookData(body) {
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return null; }
  }
  return body;
}

function normalizeSymbol(symbol) {
  return symbol?.replace(/^(BINANCE:|BYBIT:|COINBASE:|KUCOIN:|OKX:)/i, '').toUpperCase() || '';
}

async function createAlert(symbol, alertType, category, direction, timeframe, price, message, metadata = {}) {
  const settings = await db.execute({
    sql: 'SELECT * FROM alert_settings WHERE alert_type = ?',
    args: [alertType]
  });
  
  if (!settings.rows.length || !settings.rows[0].show_in_panel) return;

  await db.execute({
    sql: `INSERT INTO recent_alerts (symbol, alert_type, alert_category, direction, timeframe, price_at_alert, message, importance, timestamp, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [symbol, alertType, category, direction, timeframe, price, message, settings.rows[0].importance || 'normal', Date.now(), JSON.stringify(metadata)]
  });
}

async function recordSignal(symbol, signalType, indicator, direction, timeframe, price, metadata = {}) {
  await db.execute({
    sql: `INSERT INTO signal_history (symbol, signal_type, indicator, direction, timeframe, price_at_signal, timestamp, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [symbol, signalType, indicator, direction, timeframe, price, Date.now(), JSON.stringify(metadata)]
  });
}

async function updateSymbol(symbol, data) {
  await db.execute({
    sql: `INSERT INTO symbols (symbol, exchange, price, open, high, low, volume, last_updated, has_data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(symbol) DO UPDATE SET
            exchange = COALESCE(excluded.exchange, symbols.exchange),
            price = excluded.price,
            open = COALESCE(excluded.open, symbols.open),
            high = COALESCE(excluded.high, symbols.high),
            low = COALESCE(excluded.low, symbols.low),
            volume = COALESCE(excluded.volume, symbols.volume),
            last_updated = excluded.last_updated,
            has_data = 1`,
    args: [symbol, data.exchange || '', data.price || data.close || 0, data.open || null, data.high || null, data.low || null, data.volume || null, Date.now()]
  });
}

async function detectTradeSetups(symbol) {
  const [mssbosRes, momentumRes, sdRes, algoRes, symbolRes] = await Promise.all([
    db.execute({ sql: 'SELECT * FROM mssbos_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [symbol] }),
    db.execute({ sql: 'SELECT * FROM momentum_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [symbol] }),
    db.execute({ sql: 'SELECT * FROM supplydemand_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [symbol] }),
    db.execute({ sql: 'SELECT * FROM multialgo_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [symbol] }),
    db.execute({ sql: 'SELECT * FROM symbols WHERE symbol = ?', args: [symbol] })
  ]);

  const mssbos = mssbosRes.rows[0];
  const momentum = momentumRes.rows[0];
  const sd = sdRes.rows[0];
  const algo = algoRes.rows[0];
  const symbolInfo = symbolRes.rows[0];

  if (!symbolInfo) return;

  // Check for LONG setup
  const inHigherDemand = sd && (sd.demand_4h || sd.demand_12h || sd.demand_1d || sd.demand_1w);
  const bullishBias = mssbos && mssbos.bias === 'BULL';

  if (inHigherDemand && bullishBias) {
    let confluenceScore = 2;
    const demandTFs = [];
    if (sd.demand_4h) { demandTFs.push('4h'); confluenceScore++; }
    if (sd.demand_12h) { demandTFs.push('12h'); confluenceScore++; }
    if (sd.demand_1d) { demandTFs.push('1d'); confluenceScore++; }
    if (sd.demand_1w) { demandTFs.push('1w'); confluenceScore++; }
    if (algo?.dots_green) confluenceScore++;
    if (algo?.squares_green) confluenceScore++;
    if (momentum?.caution_count > 0) confluenceScore++;
    if (algo?.algo1_buy) confluenceScore += 2;

    const existing = await db.execute({
      sql: `SELECT * FROM trade_setups WHERE symbol = ? AND direction = 'LONG' AND status = 'ACTIVE'`,
      args: [symbol]
    });

    if (!existing.rows.length) {
      await db.execute({
        sql: `INSERT INTO trade_setups (symbol, setup_type, direction, entry_price, current_price, detected_at,
              demand_zone_tf, mssbos_signal, caution_count, has_circles, has_squares, confluence_score)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [symbol, 'CONFLUENCE', 'LONG', symbolInfo.price, symbolInfo.price, Date.now(),
          demandTFs.join(','), mssbos.bias, momentum?.caution_count || 0,
          algo?.dots_green ? 1 : 0, algo?.squares_green ? 1 : 0, confluenceScore]
      });

      await createAlert(symbol, 'LONG_SETUP', 'SETUP', 'LONG', null, symbolInfo.price,
        `Long setup: ${symbol} in ${demandTFs.join('/')} demand, bullish bias, score ${confluenceScore}`);
    }
  }

  // Check for SHORT setup
  const inHigherSupply = sd && (sd.supply_4h || sd.supply_12h || sd.supply_1d || sd.supply_1w);
  const bearishBias = mssbos && mssbos.bias === 'BEAR';

  if (inHigherSupply && bearishBias) {
    let confluenceScore = 2;
    const supplyTFs = [];
    if (sd.supply_4h) { supplyTFs.push('4h'); confluenceScore++; }
    if (sd.supply_12h) { supplyTFs.push('12h'); confluenceScore++; }
    if (sd.supply_1d) { supplyTFs.push('1d'); confluenceScore++; }
    if (sd.supply_1w) { supplyTFs.push('1w'); confluenceScore++; }
    if (algo?.dots_red) confluenceScore++;
    if (algo?.squares_red) confluenceScore++;
    if (momentum?.caution_count > 0) confluenceScore++;
    if (algo?.algo1_sell) confluenceScore += 2;

    const existing = await db.execute({
      sql: `SELECT * FROM trade_setups WHERE symbol = ? AND direction = 'SHORT' AND status = 'ACTIVE'`,
      args: [symbol]
    });

    if (!existing.rows.length) {
      await db.execute({
        sql: `INSERT INTO trade_setups (symbol, setup_type, direction, entry_price, current_price, detected_at,
              supply_zone_tf, mssbos_signal, caution_count, has_circles, has_squares, confluence_score)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [symbol, 'CONFLUENCE', 'SHORT', symbolInfo.price, symbolInfo.price, Date.now(),
          supplyTFs.join(','), mssbos.bias, momentum?.caution_count || 0,
          algo?.dots_red ? 1 : 0, algo?.squares_red ? 1 : 0, confluenceScore]
      });

      await createAlert(symbol, 'SHORT_SETUP', 'SETUP', 'SHORT', null, symbolInfo.price,
        `Short setup: ${symbol} in ${supplyTFs.join('/')} supply, bearish bias, score ${confluenceScore}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// MSS/BOS Webhook
app.post('/webhook/mssbos', async (req, res) => {
  try {
    const data = parseWebhookData(req.body);
    if (!data) return res.status(400).json({ error: 'Invalid JSON' });

    const symbol = normalizeSymbol(data.symbol || data.ticker);
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    const confluence = data.confluence || {};
    const tfs = data.timeframes || {};

    await db.execute({
      sql: `INSERT INTO mssbos_data (symbol, exchange, price, timestamp, chart_tf,
            bull_count, bear_count, bias, confluence_strength,
            tf_1m, tf_3m, tf_5m, tf_15m, tf_30m, tf_1h, tf_4h, tf_12h, tf_1d, tf_1w, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [symbol, data.exchange || '', data.price || 0, data.timestamp || Date.now(), data.chart_tf || '',
        confluence.bull_count || 0, confluence.bear_count || 0, confluence.bias || '', confluence.strength || 0,
        JSON.stringify(tfs['1m'] || {}), JSON.stringify(tfs['3m'] || {}), JSON.stringify(tfs['5m'] || {}),
        JSON.stringify(tfs['15m'] || {}), JSON.stringify(tfs['30m'] || {}), JSON.stringify(tfs['1h'] || {}),
        JSON.stringify(tfs['4h'] || {}), JSON.stringify(tfs['12h'] || {}), JSON.stringify(tfs['1d'] || {}),
        JSON.stringify(tfs['1w'] || {}), JSON.stringify(data)]
    });

    await updateSymbol(symbol, data);

    for (const [tf, tfData] of Object.entries(tfs)) {
      if (tfData.signal && tfData.signal !== 'NONE') {
        const alertType = tfData.signal.includes('MSS') ?
          (tfData.direction === 'BULL' ? 'MSS_BULLISH' : 'MSS_BEARISH') :
          (tfData.direction === 'BULL' ? 'BOS_BULLISH' : 'BOS_BEARISH');
        await createAlert(symbol, alertType, 'MSSBOS', tfData.direction, tf, data.price, `${symbol} ${tfData.signal} on ${tf.toUpperCase()}`);
        await recordSignal(symbol, tfData.signal, 'MSSBOS', tfData.direction, tf, data.price);
      }
    }

    await detectTradeSetups(symbol);
    console.log(`📊 MSS/BOS: ${symbol} @ ${data.price} - ${confluence.bias}`);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('MSS/BOS error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Momentum Webhook
app.post('/webhook/momentum', async (req, res) => {
  try {
    const data = parseWebhookData(req.body);
    if (!data) return res.status(400).json({ error: 'Invalid JSON' });

    const symbol = normalizeSymbol(data.symbol || data.ticker);
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    const structure = data.structure || {};
    const momentum = data.momentum || {};
    const caution = data.mtfCaution || {};
    const price = data.price || {};

    await db.execute({
      sql: `INSERT INTO momentum_data (symbol, exchange, price, timestamp, timeframe,
            trend, last_structure, swing_high, swing_low, invalidation_level,
            momentum_status, last_hh_percent, last_ll_percent,
            distribution_detected, distribution_drives, accumulation_detected, accumulation_drives,
            caution_count, caution_timeframes,
            caution_1m, caution_3m, caution_5m, caution_15m, caution_30m,
            caution_1h, caution_4h, caution_12h, caution_1d, caution_1w, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [symbol, data.exchange || '', price.close || data.close || 0, data.timestamp || Date.now(), data.timeframe || '',
        structure.trend || '', structure.lastStructure || '', structure.swingHigh || null, structure.swingLow || null, structure.invalidationLevel || null,
        momentum.status || '', momentum.lastHHPercent || null, momentum.lastLLPercent || null,
        momentum.distributionDetected ? 1 : 0, momentum.distributionDrives || 0,
        momentum.accumulationDetected ? 1 : 0, momentum.accumulationDrives || 0,
        caution.count || 0, caution.timeframes || '',
        caution['1m'] ? 1 : 0, caution['3m'] ? 1 : 0, caution['5m'] ? 1 : 0,
        caution['15m'] ? 1 : 0, caution['30m'] ? 1 : 0, caution['1h'] ? 1 : 0,
        caution['4h'] ? 1 : 0, caution['12h'] ? 1 : 0, caution['1d'] ? 1 : 0, caution['1w'] ? 1 : 0,
        JSON.stringify(data)]
    });

    await updateSymbol(symbol, { ...data, price: price.close || data.close });

    if (caution.count > 0) {
      await createAlert(symbol, 'CAUTION_SIGNAL', 'MOMENTUM', null, caution.timeframes, price.close || data.close,
        `${symbol} has ${caution.count} caution signals: ${caution.timeframes}`);
    }
    if (momentum.distributionDetected) {
      await createAlert(symbol, 'DISTRIBUTION', 'MOMENTUM', 'BEAR', null, price.close || data.close,
        `${symbol} distribution detected (${momentum.distributionDrives} drives)`);
      await recordSignal(symbol, 'DISTRIBUTION', 'MOMENTUM', 'BEAR', data.timeframe, price.close || data.close);
    }
    if (momentum.accumulationDetected) {
      await createAlert(symbol, 'ACCUMULATION', 'MOMENTUM', 'BULL', null, price.close || data.close,
        `${symbol} accumulation detected (${momentum.accumulationDrives} drives)`);
      await recordSignal(symbol, 'ACCUMULATION', 'MOMENTUM', 'BULL', data.timeframe, price.close || data.close);
    }

    await detectTradeSetups(symbol);
    console.log(`📈 Momentum: ${symbol} - ${structure.trend} | Caution: ${caution.count}`);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('Momentum error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Supply/Demand Webhook
app.post('/webhook/supplydemand', async (req, res) => {
  try {
    const data = parseWebhookData(req.body);
    if (!data) return res.status(400).json({ error: 'Invalid JSON' });

    const symbol = normalizeSymbol(data.symbol || data.ticker);
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    const demand = data.demand_zones || {};
    const supply = data.supply_zones || {};

    await db.execute({
      sql: `INSERT INTO supplydemand_data (symbol, exchange, price, timestamp, chart_tf,
            in_demand_zone, in_supply_zone, has_demand_rejection, has_supply_rejection,
            demand_1m, demand_3m, demand_5m, demand_15m, demand_30m,
            demand_1h, demand_4h, demand_12h, demand_1d, demand_1w,
            supply_1m, supply_3m, supply_5m, supply_15m, supply_30m,
            supply_1h, supply_4h, supply_12h, supply_1d, supply_1w, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [symbol, data.exchange || '', data.price || 0, data.timestamp || Date.now(), data.chart_tf || '',
        data.in_demand_zone ? 1 : 0, data.in_supply_zone ? 1 : 0,
        data.has_demand_rejection ? 1 : 0, data.has_supply_rejection ? 1 : 0,
        demand['1m'] ? 1 : 0, demand['3m'] ? 1 : 0, demand['5m'] ? 1 : 0,
        demand['15m'] ? 1 : 0, demand['30m'] ? 1 : 0, demand['1H'] || demand['1h'] ? 1 : 0,
        demand['4H'] || demand['4h'] ? 1 : 0, demand['12H'] || demand['12h'] ? 1 : 0,
        demand['1D'] || demand['1d'] ? 1 : 0, demand['1W'] || demand['1w'] ? 1 : 0,
        supply['1m'] ? 1 : 0, supply['3m'] ? 1 : 0, supply['5m'] ? 1 : 0,
        supply['15m'] ? 1 : 0, supply['30m'] ? 1 : 0, supply['1H'] || supply['1h'] ? 1 : 0,
        supply['4H'] || supply['4h'] ? 1 : 0, supply['12H'] || supply['12h'] ? 1 : 0,
        supply['1D'] || supply['1d'] ? 1 : 0, supply['1W'] || supply['1w'] ? 1 : 0,
        JSON.stringify(data)]
    });

    await updateSymbol(symbol, data);

    if (data.in_demand_zone) await createAlert(symbol, 'DEMAND_ZONE_ENTRY', 'ZONE', 'BULL', null, data.price, `${symbol} entered demand zone`);
    if (data.in_supply_zone) await createAlert(symbol, 'SUPPLY_ZONE_ENTRY', 'ZONE', 'BEAR', null, data.price, `${symbol} entered supply zone`);
    if (data.has_demand_rejection) {
      await createAlert(symbol, 'DEMAND_REJECTION', 'ZONE', 'BULL', null, data.price, `${symbol} demand zone rejection!`);
      await recordSignal(symbol, 'DEMAND_REJECTION', 'SUPPLYDEMAND', 'BULL', null, data.price);
    }
    if (data.has_supply_rejection) {
      await createAlert(symbol, 'SUPPLY_REJECTION', 'ZONE', 'BEAR', null, data.price, `${symbol} supply zone rejection!`);
      await recordSignal(symbol, 'SUPPLY_REJECTION', 'SUPPLYDEMAND', 'BEAR', null, data.price);
    }

    await detectTradeSetups(symbol);
    console.log(`📦 S/D: ${symbol} @ ${data.price}`);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('S/D error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Multi-Algo Webhook
app.post('/webhook/multialgo', async (req, res) => {
  try {
    const data = parseWebhookData(req.body);
    if (!data) return res.status(400).json({ error: 'Invalid JSON' });

    const symbol = normalizeSymbol(data.symbol || data.ticker);
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    await db.execute({
      sql: `INSERT INTO multialgo_data (symbol, exchange, price, timestamp, timeframe,
            dots_green, dots_red, squares_green, squares_red, background_green, background_red,
            algo1_buy, algo1_sell, algo2_buy, algo2_sell, algo3_buy, algo3_sell, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [symbol, data.exchange || '', data.price || 0, data.timestamp || Date.now(), data.timeframe || '',
        data.dots_green ? 1 : 0, data.dots_red ? 1 : 0,
        data.squares_green ? 1 : 0, data.squares_red ? 1 : 0,
        data.background_green ? 1 : 0, data.background_red ? 1 : 0,
        data.algo1_buy ? 1 : 0, data.algo1_sell ? 1 : 0,
        data.algo2_buy ? 1 : 0, data.algo2_sell ? 1 : 0,
        data.algo3_buy ? 1 : 0, data.algo3_sell ? 1 : 0,
        JSON.stringify(data)]
    });

    await updateSymbol(symbol, data);

    if (data.dots_green) await createAlert(symbol, 'DOTS_GREEN', 'ALGO', 'BULL', data.timeframe, data.price, `${symbol} green dots (OB/OS)`);
    if (data.dots_red) await createAlert(symbol, 'DOTS_RED', 'ALGO', 'BEAR', data.timeframe, data.price, `${symbol} red dots (OB/OS)`);
    if (data.algo1_buy) {
      await createAlert(symbol, 'ALGO1_BUY', 'ALGO', 'BULL', data.timeframe, data.price, `${symbol} Algo 1 BUY`);
      await recordSignal(symbol, 'ALGO1_BUY', 'MULTIALGO', 'BULL', data.timeframe, data.price);
    }
    if (data.algo1_sell) {
      await createAlert(symbol, 'ALGO1_SELL', 'ALGO', 'BEAR', data.timeframe, data.price, `${symbol} Algo 1 SELL`);
      await recordSignal(symbol, 'ALGO1_SELL', 'MULTIALGO', 'BEAR', data.timeframe, data.price);
    }

    await detectTradeSetups(symbol);
    console.log(`🤖 MultiAlgo: ${symbol} @ ${data.price}`);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('MultiAlgo error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Relative Strength Webhook
app.post('/webhook/relativestrength', async (req, res) => {
  try {
    const data = parseWebhookData(req.body);
    if (!data) return res.status(400).json({ error: 'Invalid JSON' });

    const symbol = normalizeSymbol(data.symbol || data.ticker);
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    await db.execute({
      sql: `INSERT INTO relative_strength_data (symbol, timestamp, timeframe, rs_vs_btc, rs_vs_eth, rs_vs_total, rs_rating, outperforming_btc, outperforming_eth, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [symbol, data.timestamp || Date.now(), data.timeframe || '',
        data.rs_vs_btc || 0, data.rs_vs_eth || 0, data.rs_vs_total || 0, data.rs_rating || '',
        data.outperforming_btc ? 1 : 0, data.outperforming_eth ? 1 : 0, JSON.stringify(data)]
    });

    await db.execute({
      sql: 'UPDATE symbols SET change_vs_btc_24h = ?, change_vs_eth_24h = ? WHERE symbol = ?',
      args: [data.rs_vs_btc || 0, data.rs_vs_eth || 0, symbol]
    });

    if (data.outperforming_btc) {
      await createAlert(symbol, 'RS_OUTPERFORM', 'RS', 'BULL', data.timeframe, data.price,
        `${symbol} outperforming BTC by ${data.rs_vs_btc?.toFixed(2)}%`);
    }

    console.log(`📊 RS: ${symbol} vs BTC: ${data.rs_vs_btc}%`);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('RS error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Divergence Webhook
app.post('/webhook/divergence', async (req, res) => {
  try {
    const data = parseWebhookData(req.body);
    if (!data) return res.status(400).json({ error: 'Invalid JSON' });

    const symbol = normalizeSymbol(data.symbol || data.ticker);
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    await db.execute({
      sql: `INSERT INTO divergence_data (symbol, timestamp, timeframe, divergence_type, indicator, direction, strength, price_at_signal, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [symbol, data.timestamp || Date.now(), data.timeframe || '',
        data.divergence_type || '', data.indicator || 'RSI', data.direction || '',
        data.strength || 'normal', data.price || 0, JSON.stringify(data)]
    });

    const alertType = data.direction === 'BULL' ? 'BULLISH_DIVERGENCE' : 'BEARISH_DIVERGENCE';
    await createAlert(symbol, alertType, 'DIVERGENCE', data.direction, data.timeframe, data.price,
      `${symbol} ${data.divergence_type} divergence on ${data.timeframe} (${data.indicator})`);
    await recordSignal(symbol, data.divergence_type, 'DIVERGENCE', data.direction, data.timeframe, data.price);

    console.log(`📉 Divergence: ${symbol} ${data.divergence_type} on ${data.timeframe}`);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('Divergence error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Volume Webhook
app.post('/webhook/volume', async (req, res) => {
  try {
    const data = parseWebhookData(req.body);
    if (!data) return res.status(400).json({ error: 'Invalid JSON' });

    const symbol = normalizeSymbol(data.symbol || data.ticker);
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    await db.execute({
      sql: `INSERT INTO volume_data (symbol, timestamp, timeframe, volume, volume_sma, volume_ratio, is_above_average, volume_trend, raw_data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [symbol, data.timestamp || Date.now(), data.timeframe || '',
        data.volume || 0, data.volume_sma || 0, data.volume_ratio || 0,
        data.is_above_average ? 1 : 0, data.volume_trend || '', JSON.stringify(data)]
    });

    await db.execute({
      sql: 'UPDATE symbols SET volume_avg_24h = ?, volume_ratio = ? WHERE symbol = ?',
      args: [data.volume_sma || 0, data.volume_ratio || 0, symbol]
    });

    if (data.volume_ratio > 2) {
      await createAlert(symbol, 'VOLUME_SPIKE', 'VOLUME', null, data.timeframe, data.price,
        `${symbol} volume spike ${data.volume_ratio?.toFixed(1)}x average`);
    }

    console.log(`📊 Volume: ${symbol} ${data.volume_ratio?.toFixed(1)}x avg`);
    res.json({ success: true, symbol });
  } catch (error) {
    console.error('Volume error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/symbols', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM symbols ORDER BY last_updated DESC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const symbolsRes = await db.execute('SELECT * FROM symbols ORDER BY last_updated DESC');
    
    const result = await Promise.all(symbolsRes.rows.map(async (s) => {
      const [mssbosRes, momentumRes, sdRes, algoRes, rsRes, volRes, divRes] = await Promise.all([
        db.execute({ sql: 'SELECT * FROM mssbos_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [s.symbol] }),
        db.execute({ sql: 'SELECT * FROM momentum_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [s.symbol] }),
        db.execute({ sql: 'SELECT * FROM supplydemand_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [s.symbol] }),
        db.execute({ sql: 'SELECT * FROM multialgo_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [s.symbol] }),
        db.execute({ sql: 'SELECT * FROM relative_strength_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [s.symbol] }),
        db.execute({ sql: 'SELECT * FROM volume_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [s.symbol] }),
        db.execute({ sql: 'SELECT * FROM divergence_data WHERE symbol = ? ORDER BY created_at DESC LIMIT 1', args: [s.symbol] })
      ]);

      const mssbos = mssbosRes.rows[0];
      const momentum = momentumRes.rows[0];
      const sd = sdRes.rows[0];
      const algo = algoRes.rows[0];
      const rs = rsRes.rows[0];
      const vol = volRes.rows[0];
      const div = divRes.rows[0];

      return {
        symbol: s.symbol,
        exchange: s.exchange,
        price: s.price,
        priceChange24h: s.price_change_24h,
        priceChange7d: s.price_change_7d,
        volume24h: s.volume_24h,
        marketCap: s.market_cap,
        lastUpdated: s.last_updated,
        hasData: s.has_data,
        inWatchlist: s.in_watchlist,
        changeVsBtc24h: s.change_vs_btc_24h,
        changeVsEth24h: s.change_vs_eth_24h,
        volumeRatio: s.volume_ratio || vol?.volume_ratio,
        volumeAboveAvg: vol?.is_above_average,

        mssbos: mssbos ? {
          bias: mssbos.bias,
          bullCount: mssbos.bull_count,
          bearCount: mssbos.bear_count,
          timeframes: {
            '1m': safeParseJSON(mssbos.tf_1m), '3m': safeParseJSON(mssbos.tf_3m),
            '5m': safeParseJSON(mssbos.tf_5m), '15m': safeParseJSON(mssbos.tf_15m),
            '30m': safeParseJSON(mssbos.tf_30m), '1h': safeParseJSON(mssbos.tf_1h),
            '4h': safeParseJSON(mssbos.tf_4h), '12h': safeParseJSON(mssbos.tf_12h),
            '1d': safeParseJSON(mssbos.tf_1d), '1w': safeParseJSON(mssbos.tf_1w)
          }
        } : null,

        momentum: momentum ? {
          trend: momentum.trend,
          status: momentum.momentum_status,
          cautionCount: momentum.caution_count,
          cautionTimeframes: momentum.caution_timeframes,
          distribution: momentum.distribution_detected,
          accumulation: momentum.accumulation_detected,
          cautions: {
            '1m': momentum.caution_1m, '3m': momentum.caution_3m, '5m': momentum.caution_5m,
            '15m': momentum.caution_15m, '30m': momentum.caution_30m, '1h': momentum.caution_1h,
            '4h': momentum.caution_4h, '12h': momentum.caution_12h, '1d': momentum.caution_1d, '1w': momentum.caution_1w
          }
        } : null,

        supplydemand: sd ? {
          inDemand: sd.in_demand_zone,
          inSupply: sd.in_supply_zone,
          demandRejection: sd.has_demand_rejection,
          supplyRejection: sd.has_supply_rejection,
          demandZones: {
            '1m': sd.demand_1m, '3m': sd.demand_3m, '5m': sd.demand_5m,
            '15m': sd.demand_15m, '30m': sd.demand_30m, '1h': sd.demand_1h,
            '4h': sd.demand_4h, '12h': sd.demand_12h, '1d': sd.demand_1d, '1w': sd.demand_1w
          },
          supplyZones: {
            '1m': sd.supply_1m, '3m': sd.supply_3m, '5m': sd.supply_5m,
            '15m': sd.supply_15m, '30m': sd.supply_30m, '1h': sd.supply_1h,
            '4h': sd.supply_4h, '12h': sd.supply_12h, '1d': sd.supply_1d, '1w': sd.supply_1w
          }
        } : null,

        multialgo: algo ? {
          dotsGreen: algo.dots_green, dotsRed: algo.dots_red,
          squaresGreen: algo.squares_green, squaresRed: algo.squares_red,
          algo1Buy: algo.algo1_buy, algo1Sell: algo.algo1_sell,
          algo2Buy: algo.algo2_buy, algo2Sell: algo.algo2_sell,
          algo3Buy: algo.algo3_buy, algo3Sell: algo.algo3_sell
        } : null,

        relativeStrength: rs ? {
          vsBtc: rs.rs_vs_btc, vsEth: rs.rs_vs_eth, rating: rs.rs_rating,
          outperformingBtc: rs.outperforming_btc, outperformingEth: rs.outperforming_eth
        } : null,

        divergence: div ? {
          type: div.divergence_type, indicator: div.indicator,
          direction: div.direction, timeframe: div.timeframe
        } : null
      };
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function safeParseJSON(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

app.get('/api/alerts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const category = req.query.category;
    
    let sql = 'SELECT * FROM recent_alerts WHERE show_in_panel = 1';
    const args = [];
    
    if (category) {
      sql += ' AND alert_category = ?';
      args.push(category);
    }
    
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    args.push(limit);
    
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alert-settings', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM alert_settings ORDER BY alert_type');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert-settings', async (req, res) => {
  try {
    const { alert_type, show_in_panel, importance } = req.body;
    await db.execute({
      sql: 'UPDATE alert_settings SET show_in_panel = ?, importance = ? WHERE alert_type = ?',
      args: [show_in_panel ? 1 : 0, importance || 'normal', alert_type]
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/setups', async (req, res) => {
  try {
    const status = req.query.status || 'ACTIVE';
    const result = await db.execute({
      sql: `SELECT ts.*, s.price as current_price, s.price_change_24h
            FROM trade_setups ts LEFT JOIN symbols s ON ts.symbol = s.symbol
            WHERE ts.status = ? ORDER BY ts.confluence_score DESC, ts.detected_at DESC`,
      args: [status]
    });
    
    const longs = result.rows.filter(s => s.direction === 'LONG');
    const shorts = result.rows.filter(s => s.direction === 'SHORT');
    res.json({ longs, shorts, all: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/signals', async (req, res) => {
  try {
    const symbol = req.query.symbol;
    const limit = parseInt(req.query.limit) || 100;
    
    let sql = 'SELECT * FROM signal_history';
    const args = [];
    
    if (symbol) {
      sql += ' WHERE symbol = ?';
      args.push(symbol.toUpperCase());
    }
    
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    args.push(limit);
    
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/movers', async (req, res) => {
  try {
    const timeframe = req.query.tf || '24h';
    const limit = parseInt(req.query.limit) || 20;
    const column = timeframe === '1h' ? 'price_change_1h' : timeframe === '7d' ? 'price_change_7d' : 'price_change_24h';
    
    const gainers = await db.execute({
      sql: `SELECT * FROM symbols WHERE ${column} IS NOT NULL ORDER BY ${column} DESC LIMIT ?`,
      args: [limit]
    });
    const losers = await db.execute({
      sql: `SELECT * FROM symbols WHERE ${column} IS NOT NULL ORDER BY ${column} ASC LIMIT ?`,
      args: [limit]
    });
    
    res.json({ gainers: gainers.rows, losers: losers.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/watchlist/add', async (req, res) => {
  try {
    const { symbol } = req.body;
    const normalized = normalizeSymbol(symbol);
    
    await db.execute({
      sql: `INSERT INTO symbols (symbol, in_watchlist, has_data, last_updated)
            VALUES (?, 1, 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET in_watchlist = 1`,
      args: [normalized, Date.now()]
    });
    
    res.json({ success: true, symbol: normalized });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/watchlist/remove', async (req, res) => {
  try {
    const { symbol } = req.body;
    await db.execute({
      sql: 'UPDATE symbols SET in_watchlist = 0 WHERE symbol = ?',
      args: [normalizeSymbol(symbol)]
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const [symbols, watchlist, alerts, setups] = await Promise.all([
      db.execute('SELECT COUNT(*) as count FROM symbols WHERE has_data = 1'),
      db.execute('SELECT COUNT(*) as count FROM symbols WHERE in_watchlist = 1'),
      db.execute({ sql: 'SELECT COUNT(*) as count FROM recent_alerts WHERE timestamp > ?', args: [Date.now() - 24*60*60*1000] }),
      db.execute('SELECT COUNT(*) as count FROM trade_setups WHERE status = "ACTIVE"')
    ]);
    
    res.json({
      symbols: symbols.rows[0].count,
      watchlist: watchlist.rows[0].count,
      alertsLast24h: alerts.rows[0].count,
      activeSetups: setups.rows[0].count
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// COINGECKO DATA FETCHER
// ═══════════════════════════════════════════════════════════════════════════

async function fetchMarketData() {
  const url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=1h,24h,7d';
  
  https.get(url, (resp) => {
    let data = '';
    resp.on('data', chunk => data += chunk);
    resp.on('end', async () => {
      try {
        const coins = JSON.parse(data);
        for (const coin of coins) {
          await db.execute({
            sql: `UPDATE symbols SET market_cap = ?, volume_24h = ?, price_change_1h = ?, price_change_24h = ?, price_change_7d = ?
                  WHERE UPPER(symbol) LIKE ? OR UPPER(symbol) LIKE ?`,
            args: [coin.market_cap, coin.total_volume, coin.price_change_percentage_1h_in_currency,
              coin.price_change_percentage_24h, coin.price_change_percentage_7d_in_currency,
              `%${coin.symbol.toUpperCase()}%`, `${coin.symbol.toUpperCase()}%`]
          });
        }
        console.log(`📊 Updated market data for ${coins.length} coins`);
      } catch (e) { console.error('CoinGecko parse error:', e.message); }
    });
  }).on('error', e => console.error('CoinGecko fetch error:', e.message));
}

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

async function start() {
  await initDatabase();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Trading Dashboard v2.0 - Render + Turso Edition');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  Server running on port ${PORT}`);
    console.log('');
    console.log('  Webhook Endpoints:');
    console.log('    /webhook/mssbos');
    console.log('    /webhook/momentum');
    console.log('    /webhook/supplydemand');
    console.log('    /webhook/multialgo');
    console.log('    /webhook/relativestrength');
    console.log('    /webhook/divergence');
    console.log('    /webhook/volume');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
  });

  // Fetch market data every 5 minutes
  fetchMarketData();
  setInterval(fetchMarketData, 5 * 60 * 1000);
}

start().catch(console.error);
