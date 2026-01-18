// ═══════════════════════════════════════════════════════════════════════════
// SERVER.JS UPDATE - PATCH FOR MSSBOS HANDLING
// ═══════════════════════════════════════════════════════════════════════════
// 
// FIND AND REPLACE the updateMssBosCache function with this updated version.
// This properly handles the new JSON format where each timeframe includes
// both direction AND signalType.
//
// The new format from the fixed indicator is:
// "timeframes": {
//   "1m": {"direction": "BULL", "signalType": "MSS"},
//   "4h": {"direction": "BEAR", "signalType": "BOS"},
//   ...
// }
// ═══════════════════════════════════════════════════════════════════════════

function updateMssBosCache(symbol, data) {
  const existing = cache.mssbos.get(symbol) || { timeframes: {} };
  
  let timeframes = { ...existing.timeframes };
  
  // Handle bulk format: timeframes: {1m: "BULL", 3m: "BEAR", ...} 
  // OR the new format: {1m: {direction: "BULL", signalType: "MSS"}, ...}
  if (data.timeframes && typeof data.timeframes === 'object') {
    for (const [tf, value] of Object.entries(data.timeframes)) {
      const tfKey = tf.toLowerCase();
      if (typeof value === 'string') {
        // Simple format (legacy): timeframes: {1m: "BULL"}
        // Only update signalType if we have a new direction change
        const existingDir = existing.timeframes?.[tfKey]?.direction;
        const newDir = value;
        timeframes[tfKey] = {
          direction: newDir,
          // Keep existing signalType if direction hasn't changed, otherwise clear it
          signalType: (existingDir === newDir) ? existing.timeframes?.[tfKey]?.signalType : null,
          timestamp: Date.now()
        };
      } else if (typeof value === 'object' && value !== null) {
        // Complex format (new): timeframes: {1m: {direction: "BULL", signalType: "MSS"}}
        const newDir = value.direction || value.bias;
        const newSignalType = value.signalType || value.signal_type;
        
        // Only update signalType if it's provided and not "NONE"
        // This preserves the most recent valid MSS/BOS signal
        const effectiveSignalType = (newSignalType && newSignalType !== 'NONE') 
          ? newSignalType 
          : existing.timeframes?.[tfKey]?.signalType;
        
        timeframes[tfKey] = {
          direction: newDir,
          signalType: effectiveSignalType,
          price: value.price,
          timestamp: Date.now()
        };
      }
    }
  }
  
  // Handle single TF format (legacy webhook format)
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
