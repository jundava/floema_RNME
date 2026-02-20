/**
 * @fileoverview Capa de Resiliencia y Control de Concurrencia
 * @author GAS Expert
 * @description Implementa Exponential Backoff con Jitter y sistema de Locks granulares.
 */

// ============================================================================
// 1. RETRY MANAGER (Exponential Backoff + Jitter)
// ============================================================================

/**
 * Ejecuta una función con reintentos automáticos en caso de error de concurrencia.
 * @param {Function} operacion - Función anónima o callback que contiene la lógica de lectura/escritura.
 * @param {string} contexto - Nombre descriptivo de la operación para los logs (ej. 'Leer DAT_EMPRESAS').
 * @param {number} maxReintentos - Número máximo de intentos antes de abortar (por defecto 5).
 * @returns {*} El resultado de la función ejecutada.
 */
function ejecutarConReintentos(operacion, contexto = 'Operacion_Desconocida', maxReintentos = 5) {
  let intento = 0;
  const retardoBaseMs = 1000; // 1 segundo base

  while (intento < maxReintentos) {
    try {
      // Intentamos ejecutar la operación
      return operacion();
      
    } catch (error) {
      intento++;
      
      // Errores comunes que ameritan reintento en Google Apps Script
      const mensajeError = error.message.toLowerCase();
      const esErrorConcurrencia = mensajeError.includes("concurrent") || 
                                  mensajeError.includes("too many times") || 
                                  mensajeError.includes("lock timeout") ||
                                  mensajeError.includes("exceeded");

      // Si no es un error de concurrencia o de límites, lanzamos el error de inmediato (ej. error de sintaxis)
      if (!esErrorConcurrencia && intento === 1) {
        Logger.log(`[ERROR CRÍTICO] - ${contexto}: ${error.message}`);
        throw error;
      }

      if (intento >= maxReintentos) {
        Logger.log(`[ABORTADO] - ${contexto}: Fallo tras ${maxReintentos} intentos. Último error: ${error.message}`);
        throw new Error(`El sistema está experimentando alta carga. Por favor, intente de nuevo en unos segundos. (Error interno: ${contexto})`);
      }

      // Calcular Exponential Backoff con Jitter
      // Fórmula: (2^intento * retardoBase) + Aleatorio(0, 1000)ms
      const tiempoEspera = (Math.pow(2, intento) * retardoBaseMs) + Math.floor(Math.random() * 1000);
      
      Logger.log(`[REINTENTO ${intento}/${maxReintentos}] - ${contexto} falló. Esperando ${tiempoEspera}ms...`);
      Utilities.sleep(tiempoEspera);
    }
  }
}

// ============================================================================
// 2. EJEMPLO DE USO (Patrón de Diseño para el futuro DAO)
// ============================================================================
/*
  En lugar de hacer esto:
  const data = SpreadsheetApp.getActive().getSheetByName("DAT_EMPRESAS").getDataRange().getValues();
  
  Haremos esto:
  const data = ejecutarConReintentos(() => {
    return SpreadsheetApp.getActive().getSheetByName("DAT_EMPRESAS").getDataRange().getValues();
  }, "Leer_Tabla_Empresas");
*/