const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE CONNECTION (Supabase PostgreSQL)
// ═══════════════════════════════════════════════════════════════════════════
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY CACHE - Dashboard reads from here (no DB queries!)
// ═══════════════════════════════════════════════════════════════════════════
const cache = {
  symbols: new Map(),
  mssbos: new Map(),
  momentum: new Map(),
  supplydemand: new Map(),
  multialgo: new Map(),
  alerts: [],
  signals: [],
  lastSync: 0,
  dirty: {
    symbols: new Set(),
    mssbos: new Set(),
    momentum: new Set(),
    supplydemand: new Set(),
    multialgo: new Set(),
    alerts: false,
    signals: false
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════
function normalizeSymbol(symbol) {
  return symbol?.replace(/^(BINANCE:|BYBIT:|COINBASE:|KUCOIN:|OKX:|KRAKEN:|GATEIO:|MEXC:|HUOBI:|BITFINEX:|GEMINI:|NASDAQ:|NYSE:|AMEX:|ARCA:|BATS:|LSE:|TSX:|ASX:|NSE:|BSE:|HKEX:|SSE:|SZSE:|TSE:|KRX:|MOEX:|EURONEXT:|XETRA:|FWB:|SWX:|BME:|MIL:|TADAWUL:|FOREX:|FX:|OANDA:|FXCM:|CME:|NYMEX:|COMEX:|CBOT:|ICE:|MCX:|CRYPTOCAP:|INDEX:|TVC:|FRED:|ECONOMICS:|QUANDL:)/i, '').toUpperCase() || '';
}

function detectSectionFromExchange(exchange, symbol) {
  if (!exchange) exchange = '';
  exchange = exchange.toUpperCase();
  symbol = (symbol || '').toUpperCase();
  
  const cryptoExchanges = ['BINANCE', 'BYBIT', 'COINBASE', 'KUCOIN', 'OKX', 'KRAKEN', 'GATEIO', 'MEXC', 'HUOBI', 'BITFINEX', 'GEMINI', 'BITSTAMP', 'CRYPTOCAP'];
  if (cryptoExchanges.some(e => exchange.includes(e))) return 'Crypto';
  
  const stockExchanges = ['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS', 'LSE', 'TSX', 'ASX', 'NSE', 'BSE', 'HKEX'];
  if (stockExchanges.some(e => exchange.includes(e))) return 'Stocks';
  
  const forexExchanges = ['FOREX', 'FX', 'OANDA', 'FXCM'];
  if (forexExchanges.some(e => exchange.includes(e))) return 'Forex';
  
  const futuresExchanges = ['CME', 'NYMEX', 'COMEX', 'CBOT', 'ICE', 'MCX'];
  if (futuresExchanges.some(e => exchange.includes(e))) return 'Futures';
  
  if (exchange.includes('INDEX') || exchange.includes('TVC')) return 'Index';
  
  if (symbol.endsWith('USDT') || symbol.endsWith('USD') || symbol.endsWith('BTC') || symbol.endsWith('ETH') || symbol.endsWith('BUSD') || symbol.endsWith('USDC')) return 'Crypto';
  if (symbol.includes('/')) return 'Forex';
  if (symbol.match(/^[A-Z]{1,5}$/) && !symbol.endsWith('USDT')) return 'Stocks';
  
  return 'Other';
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE UPDATE FUNCTIONS (Called by webhooks - updates memory only)
// ═══════════════════════════════════════════════════════════════════════════
function updateSymbolCache(symbol, data) {
  const existing = cache.symbols.get(symbol) || {};
  const section = data.section || existing.section || detectSectionFromExchange(data.exchange || '', symbol);
  
  cache.symbols.set(symbol, {
    ...existing,
    symbol,
    exchange: data.exchange || existing.exchange || '',
    section: existing.sectionManual ? existing.section : section,
    sectionManual: existing.sectionManual || false,
    price: data.price || data.close || existing.price || 0,
    open: data.open || existing.open,
    high: data.high || existing.high,
    low: data.low || existing.low,
    volume: data.volume || existing.volume,
    lastUpdated: Date.now(),
    hasData: true
  });
  
  cache.dirty.symbols.add(symbol);
}

function updateMssBosCache(symbol, data) {
  const existing = cache.mssbos.get(symbol) || { timeframes: {} };
  
  let timeframes = { ...existing.timeframes };
  
  // Handle bulk format: timeframes: {1m: "BULL", 3m: "BEAR", ...}
  if (data.timeframes && typeof data.timeframes === 'object') {
    for (const [tf, direction] of Object.entries(data.timeframes)) {
      timeframes[tf.toLowerCase()] = {
        direction: direction,
        timestamp: Date.now()
      };
    }
  }
  
  // Handle single TF format (legacy)
  const tf = data.timeframe?.toLowerCase() || '1h';
  if (data.direction || data.bias) {
    timeframes[tf] = {
      direction: data.direction || data.bias,
      signalType: data.signalType || data.signal_type,
      price: data.price,
      timestamp: Date.now()
    };
  }
  
  // Use provided counts or calculate from timeframes
  let bullCount = data.bull_count ?? data.bullCount;
  let bearCount = data.bear_count ?? data.bearCount;
  
  if (bullCount === undefined || bearCount === undefined) {
    bullCount = 0;
    bearCount = 0;
    Object.values(timeframes).forEach(t => {
      const dir = t.direction || t;
      if (dir === 'BULL') bullCount++;
      else if (dir === 'BEAR') bearCount++;
    });
  }
  
  cache.mssbos.set(symbol, {
    symbol,
    timeframes,
    bias: data.bias || (bullCount > bearCount ? 'BULL' : bearCount > bullCount ? 'BEAR' : 'NEUTRAL'),
    bullCount,
    bearCount,
    lastUpdated: Date.now()
  });
  
  cache.dirty.mssbos.add(symbol);
}

function updateMomentumCache(symbol, data) {
  const existing = cache.momentum.get(symbol) || { cautions: {} };
  
  let cautions = { ...existing.cautions };
  
  // Handle bulk format: caution_tfs: {1m: true, 3m: false, ...}
  if (data.caution_tfs && typeof data.caution_tfs === 'object') {
    for (const [tf, val] of Object.entries(data.caution_tfs)) {
      cautions[tf.toLowerCase()] = val === true || val === 'true';
    }
  }
  
  // Handle single TF format (legacy)
  const tf = data.timeframe?.toLowerCase() || '1h';
  if (data.hasCaution !== undefined) {
    cautions[tf] = data.hasCaution;
  }
  
  // Use provided count or calculate
  let cautionCount = data.caution_count ?? data.cautionCount;
  if (cautionCount === undefined) {
    cautionCount = Object.values(cautions).filter(v => v).length;
  }
  
  cache.momentum.set(symbol, {
    symbol,
    trend: data.trend || existing.trend,
    status: data.momentum_status || data.status || existing.status,
    cautions,
    cautionCount,
    distribution: data.distribution_detected ?? data.distribution ?? existing.distribution,
    accumulation: data.accumulation_detected ?? data.accumulation ?? existing.accumulation,
    lastUpdated: Date.now()
  });
  
  cache.dirty.momentum.add(symbol);
}

function updateSupplyDemandCache(symbol, data) {
  const existing = cache.supplydemand.get(symbol) || { demandZones: {}, supplyZones: {} };
  const now = Date.now();
  
  // Sticky duration: rejections stay "active" for 1 hour after firing
  const STICKY_DURATION = 60 * 60 * 1000; // 1 hour in ms
  
  let demandZones = { ...existing.demandZones };
  let supplyZones = { ...existing.supplyZones };
  
  // Handle bulk format: demand_zones: {1m: true, 3m: false, ...}
  if (data.demand_zones && typeof data.demand_zones === 'object') {
    for (const [tf, val] of Object.entries(data.demand_zones)) {
      demandZones[tf.toLowerCase()] = val === true || val === 'true';
    }
  }
  if (data.supply_zones && typeof data.supply_zones === 'object') {
    for (const [tf, val] of Object.entries(data.supply_zones)) {
      supplyZones[tf.toLowerCase()] = val === true || val === 'true';
    }
  }
  
  // Handle single TF format (legacy)
  const tf = data.timeframe?.toLowerCase() || '1h';
  if (data.inDemand !== undefined) demandZones[tf] = data.inDemand;
  if (data.inSupply !== undefined) supplyZones[tf] = data.inSupply;
  if (data.demandZone !== undefined) demandZones[tf] = data.demandZone;
  if (data.supplyZone !== undefined) supplyZones[tf] = data.supplyZone;
  
  // Sticky logic for zone rejections
  const getStickyRejection = (newVal, existingVal, existingTime) => {
    const incomingTrue = newVal === true || newVal === 'true';
    
    if (incomingTrue) {
      return { value: true, time: now };
    }
    
    if (existingVal && existingTime) {
      const elapsed = now - existingTime;
      if (elapsed < STICKY_DURATION) {
        return { value: true, time: existingTime };
      }
    }
    
    return { value: false, time: null };
  };
  
  const demandRej = getStickyRejection(data.demand_rejection ?? data.demandRejection, existing.demandRejection, existing.demandRejectionTime);
  const supplyRej = getStickyRejection(data.supply_rejection ?? data.supplyRejection, existing.supplyRejection, existing.supplyRejectionTime);
  
  cache.supplydemand.set(symbol, {
    symbol,
    demandZones,
    supplyZones,
    demandRejection: demandRej.value,
    demandRejectionTime: demandRej.time,
    supplyRejection: supplyRej.value,
    supplyRejectionTime: supplyRej.time,
    lastUpdated: now
  });
  
  cache.dirty.supplydemand.add(symbol);
}

function updateMultiAlgoCache(symbol, data) {
  const existing = cache.multialgo.get(symbol) || {};
  const now = Date.now();
  
  // Sticky duration: signals stay "active" for 1 hour after firing
  const STICKY_DURATION = 60 * 60 * 1000; // 1 hour in ms
  
  // Helper to convert "1"/"0" strings or 1/0 numbers to boolean
  const toBool = (val) => val === 1 || val === "1" || val === true;
  
  // Get sticky value - if new signal is true, update timestamp. If false, check if still within sticky period
  const getStickyValue = (newVal, existingVal, existingTime) => {
    const incomingTrue = toBool(newVal);
    
    if (incomingTrue) {
      // New signal! Set true and record timestamp
      return { value: true, time: now };
    }
    
    // Incoming is false - check if we should keep it sticky
    if (existingVal && existingTime) {
      const elapsed = now - existingTime;
      if (elapsed < STICKY_DURATION) {
        // Still within sticky period, keep it true
        return { value: true, time: existingTime };
      }
    }
    
    // No sticky, set to false
    return { value: false, time: null };
  };
  
  // Process each algo signal with sticky logic
  const algo1Buy = getStickyValue(data.algo1Buy ?? data.algo1_buy, existing.algo1Buy, existing.algo1BuyTime);
  const algo1Sell = getStickyValue(data.algo1Sell ?? data.algo1_sell, existing.algo1Sell, existing.algo1SellTime);
  const algo2Buy = getStickyValue(data.algo2Buy ?? data.algo2_buy, existing.algo2Buy, existing.algo2BuyTime);
  const algo2Sell = getStickyValue(data.algo2Sell ?? data.algo2_sell, existing.algo2Sell, existing.algo2SellTime);
  const algo3Buy = getStickyValue(data.algo3Buy ?? data.algo3_buy, existing.algo3Buy, existing.algo3BuyTime);
  const algo3Sell = getStickyValue(data.algo3Sell ?? data.algo3_sell, existing.algo3Sell, existing.algo3SellTime);
  
  // OB/OS (dots) are also sticky now
  const dotsGreen = getStickyValue(data.dotsGreen ?? data.dots_green, existing.dotsGreen, existing.dotsGreenTime);
  const dotsRed = getStickyValue(data.dotsRed ?? data.dots_red, existing.dotsRed, existing.dotsRedTime);
  
  cache.multialgo.set(symbol, {
    symbol,
    dotsGreen: dotsGreen.value,
    dotsGreenTime: dotsGreen.time,
    dotsRed: dotsRed.value,
    dotsRedTime: dotsRed.time,
    algo1Buy: algo1Buy.value,
    algo1BuyTime: algo1Buy.time,
    algo1Sell: algo1Sell.value,
    algo1SellTime: algo1Sell.time,
    algo2Buy: algo2Buy.value,
    algo2BuyTime: algo2Buy.time,
    algo2Sell: algo2Sell.value,
    algo2SellTime: algo2Sell.time,
    algo3Buy: algo3Buy.value,
    algo3BuyTime: algo3Buy.time,
    algo3Sell: algo3Sell.value,
    algo3SellTime: algo3Sell.time,
    lastUpdated: now
  });
  
  cache.dirty.multialgo.add(symbol);
}

function addAlert(alert) {
  cache.alerts.unshift({
    ...alert,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    timestamp: Date.now(),
    show_in_panel: true
  });
  
  if (cache.alerts.length > 500) {
    cache.alerts = cache.alerts.slice(0, 500);
  }
  
  cache.dirty.alerts = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE SYNC (Runs every 1 minute - writes dirty data to DB)
// ═══════════════════════════════════════════════════════════════════════════
async function syncToDatabase() {
  console.log('🔄 Starting database sync...');
  const startTime = Date.now();
  let syncCount = 0;
  
  const client = await pool.connect();
  
  try {
    // Sync dirty symbols
    for (const symbol of cache.dirty.symbols) {
      const data = cache.symbols.get(symbol);
      if (data) {
        await client.query(`
          INSERT INTO symbols (symbol, exchange, section, section_manual, price, open, high, low, volume, last_updated, has_data)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
          ON CONFLICT (symbol) DO UPDATE SET
            exchange = EXCLUDED.exchange,
            section = EXCLUDED.section,
            section_manual = EXCLUDED.section_manual,
            price = EXCLUDED.price,
            open = COALESCE(EXCLUDED.open, symbols.open),
            high = COALESCE(EXCLUDED.high, symbols.high),
            low = COALESCE(EXCLUDED.low, symbols.low),
            volume = COALESCE(EXCLUDED.volume, symbols.volume),
            last_updated = EXCLUDED.last_updated,
            has_data = true
        `, [symbol, data.exchange, data.section, data.sectionManual, data.price, data.open, data.high, data.low, data.volume, data.lastUpdated]);
        syncCount++;
      }
    }
    cache.dirty.symbols.clear();
    
    // Sync dirty mssbos
    for (const symbol of cache.dirty.mssbos) {
      const data = cache.mssbos.get(symbol);
      if (data) {
        await client.query(`
          INSERT INTO mssbos_data (symbol, timeframes_json, bias, bull_count, bear_count, last_updated)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (symbol) DO UPDATE SET
            timeframes_json = EXCLUDED.timeframes_json,
            bias = EXCLUDED.bias,
            bull_count = EXCLUDED.bull_count,
            bear_count = EXCLUDED.bear_count,
            last_updated = EXCLUDED.last_updated
        `, [symbol, JSON.stringify(data.timeframes), data.bias, data.bullCount, data.bearCount, data.lastUpdated]);
        syncCount++;
      }
    }
    cache.dirty.mssbos.clear();
    
    // Sync dirty momentum
    for (const symbol of cache.dirty.momentum) {
      const data = cache.momentum.get(symbol);
      if (data) {
        await client.query(`
          INSERT INTO momentum_data (symbol, trend, status, cautions_json, caution_count, distribution, accumulation, last_updated)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (symbol) DO UPDATE SET
            trend = EXCLUDED.trend,
            status = EXCLUDED.status,
            cautions_json = EXCLUDED.cautions_json,
            caution_count = EXCLUDED.caution_count,
            distribution = EXCLUDED.distribution,
            accumulation = EXCLUDED.accumulation,
            last_updated = EXCLUDED.last_updated
        `, [symbol, data.trend, data.status, JSON.stringify(data.cautions), data.cautionCount, data.distribution, data.accumulation, data.lastUpdated]);
        syncCount++;
      }
    }
    cache.dirty.momentum.clear();
    
    // Sync dirty supplydemand
    for (const symbol of cache.dirty.supplydemand) {
      const data = cache.supplydemand.get(symbol);
      if (data) {
        await client.query(`
          INSERT INTO supplydemand_data (symbol, demand_zones_json, supply_zones_json, demand_rejection, supply_rejection, demand_rejection_time, supply_rejection_time, last_updated)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (symbol) DO UPDATE SET
            demand_zones_json = EXCLUDED.demand_zones_json,
            supply_zones_json = EXCLUDED.supply_zones_json,
            demand_rejection = EXCLUDED.demand_rejection,
            supply_rejection = EXCLUDED.supply_rejection,
            demand_rejection_time = EXCLUDED.demand_rejection_time,
            supply_rejection_time = EXCLUDED.supply_rejection_time,
            last_updated = EXCLUDED.last_updated
        `, [symbol, JSON.stringify(data.demandZones), JSON.stringify(data.supplyZones), data.demandRejection, data.supplyRejection, data.demandRejectionTime, data.supplyRejectionTime, data.lastUpdated]);
        syncCount++;
      }
    }
    cache.dirty.supplydemand.clear();
    
    // Sync dirty multialgo
    for (const symbol of cache.dirty.multialgo) {
      const data = cache.multialgo.get(symbol);
      if (data) {
        await client.query(`
          INSERT INTO multialgo_data (symbol, dots_green, dots_red, dots_green_time, dots_red_time, algo1_buy, algo1_sell, algo2_buy, algo2_sell, algo3_buy, algo3_sell, algo1_buy_time, algo1_sell_time, algo2_buy_time, algo2_sell_time, algo3_buy_time, algo3_sell_time, last_updated)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (symbol) DO UPDATE SET
            dots_green = EXCLUDED.dots_green,
            dots_red = EXCLUDED.dots_red,
            dots_green_time = EXCLUDED.dots_green_time,
            dots_red_time = EXCLUDED.dots_red_time,
            algo1_buy = EXCLUDED.algo1_buy,
            algo1_sell = EXCLUDED.algo1_sell,
            algo2_buy = EXCLUDED.algo2_buy,
            algo2_sell = EXCLUDED.algo2_sell,
            algo3_buy = EXCLUDED.algo3_buy,
            algo3_sell = EXCLUDED.algo3_sell,
            algo1_buy_time = EXCLUDED.algo1_buy_time,
            algo1_sell_time = EXCLUDED.algo1_sell_time,
            algo2_buy_time = EXCLUDED.algo2_buy_time,
            algo2_sell_time = EXCLUDED.algo2_sell_time,
            algo3_buy_time = EXCLUDED.algo3_buy_time,
            algo3_sell_time = EXCLUDED.algo3_sell_time,
            last_updated = EXCLUDED.last_updated
        `, [symbol, data.dotsGreen, data.dotsRed, data.dotsGreenTime, data.dotsRedTime, data.algo1Buy, data.algo1Sell, data.algo2Buy, data.algo2Sell, data.algo3Buy, data.algo3Sell, data.algo1BuyTime, data.algo1SellTime, data.algo2BuyTime, data.algo2SellTime, data.algo3BuyTime, data.algo3SellTime, data.lastUpdated]);
        syncCount++;
      }
    }
    cache.dirty.multialgo.clear();
    
    // Sync alerts
    if (cache.dirty.alerts && cache.alerts.length > 0) {
      const newAlerts = cache.alerts.slice(0, 50);
      for (const alert of newAlerts) {
        await client.query(`
          INSERT INTO recent_alerts (id, symbol, alert_type, alert_category, direction, timeframe, price_at_alert, message, importance, timestamp, show_in_panel)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
          ON CONFLICT (id) DO NOTHING
        `, [alert.id, alert.symbol, alert.alert_type, alert.alert_category, alert.direction, alert.timeframe, alert.price_at_alert, alert.message, alert.importance, alert.timestamp]);
      }
      cache.dirty.alerts = false;
      syncCount += newAlerts.length;
    }
    
    cache.lastSync = Date.now();
    console.log(`✅ Database sync complete: ${syncCount} records in ${Date.now() - startTime}ms`);
    
  } catch (error) {
    console.error('❌ Database sync error:', error.message);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD FROM DATABASE ON STARTUP
// ═══════════════════════════════════════════════════════════════════════════
async function loadFromDatabase() {
  console.log('📥 Loading data from database...');
  
  const client = await pool.connect();
  
  try {
    // Load symbols
    const symbols = await client.query('SELECT * FROM symbols');
    for (const row of symbols.rows) {
      cache.symbols.set(row.symbol, {
        symbol: row.symbol,
        exchange: row.exchange,
        section: row.section || 'Other',
        sectionManual: row.section_manual,
        price: parseFloat(row.price) || 0,
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        volume: parseFloat(row.volume),
        lastUpdated: parseInt(row.last_updated),
        hasData: row.has_data
      });
    }
    console.log(`  Loaded ${symbols.rows.length} symbols`);
    
    // Load mssbos
    const mssbos = await client.query('SELECT * FROM mssbos_data');
    for (const row of mssbos.rows) {
      cache.mssbos.set(row.symbol, {
        symbol: row.symbol,
        timeframes: JSON.parse(row.timeframes_json || '{}'),
        bias: row.bias,
        bullCount: row.bull_count,
        bearCount: row.bear_count,
        lastUpdated: parseInt(row.last_updated)
      });
    }
    console.log(`  Loaded ${mssbos.rows.length} MSS/BOS records`);
    
    // Load momentum
    const momentum = await client.query('SELECT * FROM momentum_data');
    for (const row of momentum.rows) {
      cache.momentum.set(row.symbol, {
        symbol: row.symbol,
        trend: row.trend,
        status: row.status,
        cautions: JSON.parse(row.cautions_json || '{}'),
        cautionCount: row.caution_count,
        distribution: row.distribution,
        accumulation: row.accumulation,
        lastUpdated: parseInt(row.last_updated)
      });
    }
    console.log(`  Loaded ${momentum.rows.length} momentum records`);
    
    // Load supplydemand
    const sd = await client.query('SELECT * FROM supplydemand_data');
    for (const row of sd.rows) {
      cache.supplydemand.set(row.symbol, {
        symbol: row.symbol,
        demandZones: JSON.parse(row.demand_zones_json || '{}'),
        supplyZones: JSON.parse(row.supply_zones_json || '{}'),
        demandRejection: row.demand_rejection,
        supplyRejection: row.supply_rejection,
        demandRejectionTime: row.demand_rejection_time ? parseInt(row.demand_rejection_time) : null,
        supplyRejectionTime: row.supply_rejection_time ? parseInt(row.supply_rejection_time) : null,
        lastUpdated: parseInt(row.last_updated)
      });
    }
    console.log(`  Loaded ${sd.rows.length} supply/demand records`);
    
    // Load multialgo
    const algo = await client.query('SELECT * FROM multialgo_data');
    for (const row of algo.rows) {
      cache.multialgo.set(row.symbol, {
        symbol: row.symbol,
        dotsGreen: row.dots_green,
        dotsRed: row.dots_red,
        dotsGreenTime: row.dots_green_time ? parseInt(row.dots_green_time) : null,
        dotsRedTime: row.dots_red_time ? parseInt(row.dots_red_time) : null,
        algo1Buy: row.algo1_buy,
        algo1Sell: row.algo1_sell,
        algo2Buy: row.algo2_buy,
        algo2Sell: row.algo2_sell,
        algo3Buy: row.algo3_buy,
        algo3Sell: row.algo3_sell,
        algo1BuyTime: row.algo1_buy_time ? parseInt(row.algo1_buy_time) : null,
        algo1SellTime: row.algo1_sell_time ? parseInt(row.algo1_sell_time) : null,
        algo2BuyTime: row.algo2_buy_time ? parseInt(row.algo2_buy_time) : null,
        algo2SellTime: row.algo2_sell_time ? parseInt(row.algo2_sell_time) : null,
        algo3BuyTime: row.algo3_buy_time ? parseInt(row.algo3_buy_time) : null,
        algo3SellTime: row.algo3_sell_time ? parseInt(row.algo3_sell_time) : null,
        lastUpdated: parseInt(row.last_updated)
      });
    }
    console.log(`  Loaded ${algo.rows.length} multi-algo records`);
    
    // Load recent alerts
    const alerts = await client.query('SELECT * FROM recent_alerts ORDER BY timestamp DESC LIMIT 500');
    cache.alerts = alerts.rows.map(row => ({
      id: row.id,
      symbol: row.symbol,
      alert_type: row.alert_type,
      alert_category: row.alert_category,
      direction: row.direction,
      timeframe: row.timeframe,
      price_at_alert: parseFloat(row.price_at_alert),
      message: row.message,
      importance: row.importance,
      timestamp: parseInt(row.timestamp),
      show_in_panel: row.show_in_panel
    }));
    console.log(`  Loaded ${cache.alerts.length} alerts`);
    
    console.log('✅ Database load complete');
    
  } catch (error) {
    console.error('❌ Database load error:', error.message);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE SCHEMA INIT (PostgreSQL)
// ═══════════════════════════════════════════════════════════════════════════
async function initDatabase() {
  console.log('🗄️ Initializing database schema...');
  
  const client = await pool.connect();
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS symbols (
        symbol TEXT PRIMARY KEY,
        exchange TEXT,
        section TEXT DEFAULT 'Other',
        section_manual BOOLEAN DEFAULT false,
        price DECIMAL,
        open DECIMAL,
        high DECIMAL,
        low DECIMAL,
        volume DECIMAL,
        last_updated BIGINT,
        has_data BOOLEAN DEFAULT false
      )
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS mssbos_data (
        symbol TEXT PRIMARY KEY,
        timeframes_json TEXT,
        bias TEXT,
        bull_count INTEGER,
        bear_count INTEGER,
        last_updated BIGINT
      )
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS momentum_data (
        symbol TEXT PRIMARY KEY,
        trend TEXT,
        status TEXT,
        cautions_json TEXT,
        caution_count INTEGER,
        distribution BOOLEAN,
        accumulation BOOLEAN,
        last_updated BIGINT
      )
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplydemand_data (
        symbol TEXT PRIMARY KEY,
        demand_zones_json TEXT,
        supply_zones_json TEXT,
        demand_rejection BOOLEAN,
        supply_rejection BOOLEAN,
        demand_rejection_time BIGINT,
        supply_rejection_time BIGINT,
        last_updated BIGINT
      )
    `);
    
    // Add timestamp columns if they don't exist
    await client.query(`ALTER TABLE supplydemand_data ADD COLUMN IF NOT EXISTS demand_rejection_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE supplydemand_data ADD COLUMN IF NOT EXISTS supply_rejection_time BIGINT`).catch(() => {});
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS multialgo_data (
        symbol TEXT PRIMARY KEY,
        dots_green BOOLEAN,
        dots_red BOOLEAN,
        dots_green_time BIGINT,
        dots_red_time BIGINT,
        algo1_buy BOOLEAN,
        algo1_sell BOOLEAN,
        algo2_buy BOOLEAN,
        algo2_sell BOOLEAN,
        algo3_buy BOOLEAN,
        algo3_sell BOOLEAN,
        algo1_buy_time BIGINT,
        algo1_sell_time BIGINT,
        algo2_buy_time BIGINT,
        algo2_sell_time BIGINT,
        algo3_buy_time BIGINT,
        algo3_sell_time BIGINT,
        last_updated BIGINT
      )
    `);
    
    // Add timestamp columns if they don't exist (for existing databases)
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS dots_green_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS dots_red_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS algo1_buy_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS algo1_sell_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS algo2_buy_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS algo2_sell_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS algo3_buy_time BIGINT`).catch(() => {});
    await client.query(`ALTER TABLE multialgo_data ADD COLUMN IF NOT EXISTS algo3_sell_time BIGINT`).catch(() => {});
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS recent_alerts (
        id TEXT PRIMARY KEY,
        symbol TEXT,
        alert_type TEXT,
        alert_category TEXT,
        direction TEXT,
        timeframe TEXT,
        price_at_alert DECIMAL,
        message TEXT,
        importance TEXT,
        timestamp BIGINT,
        show_in_panel BOOLEAN DEFAULT true
      )
    `);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS alert_settings (
        alert_type TEXT PRIMARY KEY,
        show_in_panel BOOLEAN DEFAULT true,
        sound_enabled BOOLEAN DEFAULT false
      )
    `);
    
    console.log('✅ Database schema ready');
    
  } catch (error) {
    console.error('Schema error:', error.message);
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED WEBHOOK ENDPOINT (Routes based on alert_type in body)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/webhook', (req, res) => {
  try {
    const data = req.body;
    const alertType = (data.alert_type || data.alertType || data.type || '').toUpperCase();
    const symbol = normalizeSymbol(data.symbol || data.ticker);
    
    if (!symbol) {
      console.log('⚠️ Webhook received with no symbol:', JSON.stringify(data).slice(0, 200));
      return res.status(400).json({ error: 'No symbol provided' });
    }
    
    console.log(`📨 Webhook: ${symbol} - ${alertType} @ ${data.price || 'N/A'}`);
    
    // Update symbol cache for all types
    updateSymbolCache(symbol, data);
    
    // Route to appropriate handler based on alert_type
    if (alertType === 'MSSBOS' || alertType === 'MSS' || alertType === 'BOS') {
      updateMssBosCache(symbol, data);
      addAlert({
        symbol,
        alert_type: 'MSSBOS',
        message: `${data.bias || 'NEUTRAL'} bias - ${data.bull_count || 0}B/${data.bear_count || 0}Be`,
        data: JSON.stringify(data)
      });
    } 
    else if (alertType === 'MOMENTUM' || alertType === 'MOM' || alertType === 'CAUTION') {
      updateMomentumCache(symbol, data);
      addAlert({
        symbol,
        alert_type: 'MOMENTUM',
        message: `${data.trend || 'N/A'} - ${data.momentum_status || 'N/A'}`,
        data: JSON.stringify(data)
      });
    }
    else if (alertType === 'SUPPLYDEMAND' || alertType === 'SD' || alertType === 'SUPPLY' || alertType === 'DEMAND') {
      updateSupplyDemandCache(symbol, data);
      addAlert({
        symbol,
        alert_type: 'SUPPLYDEMAND',
        message: `D:${data.demand_rejection ? '✓' : '-'} S:${data.supply_rejection ? '✓' : '-'}`,
        data: JSON.stringify(data)
      });
    }
    else if (alertType === 'MULTIALGO' || alertType === 'ALGO' || alertType === 'SIGNAL') {
      updateMultiAlgoCache(symbol, data);
      addSignal({
        symbol,
        signal_type: data.signal_type || data.direction || 'UNKNOWN',
        data: JSON.stringify(data)
      });
    }
    else if (alertType === 'COMBINED' || alertType === 'MASTER') {
      // MASTER alert - contains mssbos, supplydemand, momentum, AND multialgo all in one
      console.log(`📦 Master 4-in-1 alert for ${symbol}`);
      
      // Process MSS/BOS data
      if (data.mssbos) {
        const mssbosData = {
          ...data.mssbos,
          symbol: data.symbol,
          price: data.price
        };
        updateMssBosCache(symbol, mssbosData);
      }
      
      // Process Supply/Demand data
      if (data.supplydemand) {
        const sdData = {
          ...data.supplydemand,
          symbol: data.symbol,
          price: data.price
        };
        updateSupplyDemandCache(symbol, sdData);
      }
      
      // Process Momentum data
      if (data.momentum) {
        const momData = {
          ...data.momentum,
          symbol: data.symbol,
          price: data.price
        };
        updateMomentumCache(symbol, momData);
      }
      
      // Process Multi-Algo data
      if (data.multialgo) {
        const algoData = {
          ...data.multialgo,
          symbol: data.symbol,
          price: data.price
        };
        updateMultiAlgoCache(symbol, algoData);
      }
      
      addAlert({
        symbol,
        alert_type: 'MASTER',
        message: `MSS:${data.mssbos?.bias || '-'} | S/D:${data.supplydemand?.demand_rejection ? 'D✓' : ''}${data.supplydemand?.supply_rejection ? 'S✓' : ''} | Caution:${data.momentum?.caution_count || 0} | Algo:${data.multialgo?.algo1_buy || data.multialgo?.algo2_buy || data.multialgo?.algo3_buy ? 'BUY' : ''}${data.multialgo?.algo1_sell || data.multialgo?.algo2_sell || data.multialgo?.algo3_sell ? 'SELL' : ''}`,
        data: JSON.stringify(data)
      });
    }
    else {
      // Unknown type - log it but still accept
      console.log(`⚠️ Unknown alert_type: ${alertType} for ${symbol}`);
    }
    
    res.json({ success: true, symbol, type: alertType });
  } catch (error) {
    console.error('❌ Webhook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK ENDPOINTS (Write to cache only - fast!)
// ═══════════════════════════════════════════════════════════════════════════
app.post('/webhook/mssbos', (req, res) => {
  try {
    const data = req.body;
    const symbol = normalizeSymbol(data.symbol || data.ticker);
    
    if (!symbol) return res.status(400).json({ error: 'No symbol' });
    
    updateSymbolCache(symbol, data);
    updateMssBosCache(symbol, data);
    
    addAlert({
      symbol,
      alert_type: `${data.signalType || 'MSS'}_${data.direction || 'BULL'}`,
      alert_category: 'MSSBOS',
      direction: data.direction || data.bias,
      timeframe: data.timeframe,
      price_at_alert: data.price || data.close,
      message: `${symbol} ${data.signalType || 'MSS'}_${data.direction} on ${data.timeframe}`,
      importance: 'normal'
    });
    
    console.log(`📊 MSS/BOS: ${symbol} @ ${data.price} - ${data.direction} (${data.timeframe})`);
    res.json({ success: true, symbol });
    
  } catch (error) {
    console.error('MSS/BOS webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook/momentum', (req, res) => {
  try {
    const data = req.body;
    const symbol = normalizeSymbol(data.symbol || data.ticker);
    
    if (!symbol) return res.status(400).json({ error: 'No symbol' });
    
    updateSymbolCache(symbol, data);
    updateMomentumCache(symbol, data);
    
    if (data.hasCaution) {
      addAlert({
        symbol,
        alert_type: 'CAUTION',
        alert_category: 'MOMENTUM',
        direction: data.trend,
        timeframe: data.timeframe,
        price_at_alert: data.price || data.close,
        message: `${symbol} Caution on ${data.timeframe}`,
        importance: 'normal'
      });
    }
    
    console.log(`📈 Momentum: ${symbol} - ${data.trend || 'N/A'} | Caution: ${data.hasCaution ? 'Yes' : 'No'}`);
    res.json({ success: true, symbol });
    
  } catch (error) {
    console.error('Momentum webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook/supplydemand', (req, res) => {
  try {
    const data = req.body;
    const symbol = normalizeSymbol(data.symbol || data.ticker);
    
    if (!symbol) return res.status(400).json({ error: 'No symbol' });
    
    updateSymbolCache(symbol, data);
    updateSupplyDemandCache(symbol, data);
    
    const zoneType = data.inDemand || data.demandZone ? 'DEMAND' : data.inSupply || data.supplyZone ? 'SUPPLY' : null;
    if (zoneType) {
      addAlert({
        symbol,
        alert_type: `IN_${zoneType}`,
        alert_category: 'ZONE',
        direction: zoneType === 'DEMAND' ? 'BULL' : 'BEAR',
        timeframe: data.timeframe,
        price_at_alert: data.price || data.close,
        message: `${symbol} in ${zoneType} zone on ${data.timeframe}`,
        importance: 'normal'
      });
    }
    
    if (data.demandRejection) {
      addAlert({
        symbol, alert_type: 'DEMAND_REJECTION', alert_category: 'ZONE', direction: 'BULL',
        timeframe: data.timeframe, price_at_alert: data.price || data.close,
        message: `${symbol} Demand Rejection`, importance: 'high'
      });
    }
    
    if (data.supplyRejection) {
      addAlert({
        symbol, alert_type: 'SUPPLY_REJECTION', alert_category: 'ZONE', direction: 'BEAR',
        timeframe: data.timeframe, price_at_alert: data.price || data.close,
        message: `${symbol} Supply Rejection`, importance: 'high'
      });
    }
    
    console.log(`📦 S/D: ${symbol} @ ${data.price} (${data.timeframe})`);
    res.json({ success: true, symbol });
    
  } catch (error) {
    console.error('Supply/Demand webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook/multialgo', (req, res) => {
  try {
    const data = req.body;
    const symbol = normalizeSymbol(data.symbol || data.ticker);
    
    if (!symbol) return res.status(400).json({ error: 'No symbol' });
    
    updateSymbolCache(symbol, data);
    updateMultiAlgoCache(symbol, data);
    
    if (data.dotsGreen || data.dots_green) {
      addAlert({ symbol, alert_type: 'DOTS_GREEN', alert_category: 'ALGO', direction: 'BULL', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} 15M+1H Overbought`, importance: 'normal' });
    }
    if (data.dotsRed || data.dots_red) {
      addAlert({ symbol, alert_type: 'DOTS_RED', alert_category: 'ALGO', direction: 'BEAR', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} 15M+1H Oversold`, importance: 'normal' });
    }
    if (data.algo1Buy || data.algo1_buy) {
      addAlert({ symbol, alert_type: 'ALGO1_BUY', alert_category: 'ALGO', direction: 'BULL', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} Algo 1 BUY`, importance: 'high' });
    }
    if (data.algo1Sell || data.algo1_sell) {
      addAlert({ symbol, alert_type: 'ALGO1_SELL', alert_category: 'ALGO', direction: 'BEAR', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} Algo 1 SELL`, importance: 'high' });
    }
    if (data.algo2Buy || data.algo2_buy) {
      addAlert({ symbol, alert_type: 'ALGO2_BUY', alert_category: 'ALGO', direction: 'BULL', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} Algo 2 BUY`, importance: 'normal' });
    }
    if (data.algo2Sell || data.algo2_sell) {
      addAlert({ symbol, alert_type: 'ALGO2_SELL', alert_category: 'ALGO', direction: 'BEAR', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} Algo 2 SELL`, importance: 'normal' });
    }
    if (data.algo3Buy || data.algo3_buy) {
      addAlert({ symbol, alert_type: 'ALGO3_BUY', alert_category: 'ALGO', direction: 'BULL', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} Algo 3 BUY`, importance: 'normal' });
    }
    if (data.algo3Sell || data.algo3_sell) {
      addAlert({ symbol, alert_type: 'ALGO3_SELL', alert_category: 'ALGO', direction: 'BEAR', timeframe: data.timeframe, price_at_alert: data.price, message: `${symbol} Algo 3 SELL`, importance: 'normal' });
    }
    
    console.log(`🤖 MultiAlgo: ${symbol} @ ${data.price}`);
    res.json({ success: true, symbol });
    
  } catch (error) {
    console.error('MultiAlgo webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/webhook/:type', (req, res) => {
  try {
    const { type } = req.params;
    const data = req.body;
    const symbol = normalizeSymbol(data.symbol || data.ticker);
    
    if (!symbol) return res.status(400).json({ error: 'No symbol' });
    
    updateSymbolCache(symbol, data);
    
    console.log(`📡 ${type}: ${symbol} @ ${data.price}`);
    res.json({ success: true, symbol, type });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// API ENDPOINTS (Read from cache - instant!)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/dashboard', (req, res) => {
  try {
    const result = [];
    
    for (const [symbol, symbolData] of cache.symbols) {
      result.push({
        symbol,
        exchange: symbolData.exchange,
        section: symbolData.section || 'Other',
        price: symbolData.price,
        priceChange24h: symbolData.priceChange24h,
        changeVsBtc24h: symbolData.changeVsBtc24h,
        volumeRatio: symbolData.volumeRatio,
        lastUpdated: symbolData.lastUpdated,
        hasData: symbolData.hasData,
        inWatchlist: symbolData.inWatchlist,
        mssbos: cache.mssbos.get(symbol) || null,
        momentum: cache.momentum.get(symbol) || null,
        supplydemand: cache.supplydemand.get(symbol) || null,
        multialgo: cache.multialgo.get(symbol) || null
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alerts', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const category = req.query.category;
    const type = req.query.type;
    
    let alerts = cache.alerts.filter(a => a.show_in_panel);
    
    if (category) alerts = alerts.filter(a => a.alert_category === category);
    if (type) alerts = alerts.filter(a => a.alert_type?.startsWith(type));
    
    res.json(alerts.slice(0, limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sections', (req, res) => {
  try {
    const sections = new Set(['All']);
    for (const [, data] of cache.symbols) {
      if (data.section) sections.add(data.section);
    }
    res.json([...sections].sort());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/symbol/section', (req, res) => {
  try {
    const { symbol, section } = req.body;
    const sym = symbol.toUpperCase();
    const data = cache.symbols.get(sym);
    if (data) {
      data.section = section;
      data.sectionManual = true;
      cache.dirty.symbols.add(sym);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/symbol/section/reset', (req, res) => {
  try {
    const { symbol } = req.body;
    const sym = symbol.toUpperCase();
    const data = cache.symbols.get(sym);
    if (data) {
      data.section = detectSectionFromExchange(data.exchange, sym);
      data.sectionManual = false;
      cache.dirty.symbols.add(sym);
      res.json({ success: true, section: data.section });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/signals', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    res.json(cache.signals.slice(0, limit));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    res.json({
      symbols: cache.symbols.size,
      alerts: cache.alerts.length,
      lastSync: cache.lastSync,
      cacheStatus: 'active'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/alert-settings', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM alert_settings');
    client.release();
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/alert-settings', async (req, res) => {
  try {
    const { alert_type, show_in_panel } = req.body;
    const client = await pool.connect();
    await client.query(`
      INSERT INTO alert_settings (alert_type, show_in_panel) VALUES ($1, $2)
      ON CONFLICT (alert_type) DO UPDATE SET show_in_panel = EXCLUDED.show_in_panel
    `, [alert_type, show_in_panel]);
    client.release();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: Date.now(),
    database: 'supabase',
    cacheSize: { symbols: cache.symbols.size, alerts: cache.alerts.length },
    lastSync: cache.lastSync
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════════════════
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await initDatabase();
    await loadFromDatabase();
    
    setInterval(syncToDatabase, 60 * 1000);
    console.log('⏰ Database sync scheduled every 1 minute');
    
    app.listen(PORT, () => {
      console.log(`🚀 Trading Dashboard running on port ${PORT}`);
      console.log('📊 In-memory caching ACTIVE - unlimited reads!');
      console.log('🗄️ Database: Supabase PostgreSQL');
    });
  } catch (error) {
    console.error('Startup error:', error);
  }
}

start();
