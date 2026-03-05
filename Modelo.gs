/**
 * @fileoverview Capa de Acceso a Datos (DAO) para Google Sheets
 * @author GAS Expert
 * @description Operaciones atómicas de lectura/escritura con sanitización para el Frontend.
 */

// ============================================================================
// 1. LECTURA UNIVERSAL DE TABLAS (Get)
// ============================================================================

/**
 * Lee una tabla completa y la transforma en un array de objetos (JSON amigable).
 * @param {string} nombreTabla - El nombre de la hoja en Sheets (ej. 'APP_CATALOGOS').
 * @returns {Array<Object>} Array de diccionarios con la data.
 */
function getTabla(nombreTabla) {
  return ejecutarConReintentos(() => {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreTabla);
    if (!sheet) throw new Error(`[DAO GET] La tabla ${nombreTabla} no existe en la BD.`);

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return []; // Retorna array vacío si solo hay cabeceras o está vacía

    const headers = data[0];
    const rows = data.slice(1);

    // Mapear matriz 2D a Array de Objetos JSON
    return rows.map(row => {
      let obj = {};
      headers.forEach((header, index) => {
        let valor = row[index];
        
        // Sanitización estricta para serialización JSON hacia el Frontend
        if (valor instanceof Date) {
          valor = valor.toISOString();
        } else if (typeof valor === 'string') {
          // Normalizar booleanos de texto si existen
          if (valor.toUpperCase() === 'TRUE') valor = true;
          if (valor.toUpperCase() === 'FALSE') valor = false;
        }
        
        obj[header] = valor;
      });
      return obj;
    });
  }, `Leer_Tabla_${nombreTabla}`);
}


// ============================================================================
// 2. ESCRITURA ATÓMICA EN BLOQUE (Insert)
// ============================================================================

/**
 * Inserta un bloque de registros en una tabla garantizando el orden del esquema.
 * @param {string} nombreTabla - Nombre de la tabla destino (ej. 'DAT_RESPUESTAS').
 * @param {Array<Object>} arrayRegistros - Array de objetos JSON provenientes del frontend.
 * @returns {boolean} True si fue exitoso.
 */
function insertarEnTabla(nombreTabla, arrayRegistros) {
  if (!arrayRegistros || arrayRegistros.length === 0) return false;

  return ejecutarConReintentos(() => {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreTabla);
    if (!sheet) throw new Error(`[DAO INSERT] La tabla ${nombreTabla} no existe en la BD.`);

    // 1. Obtener el esquema estricto desde Auxiliares.gs para garantizar el orden de las columnas
    const esquemaColumnas = DB_SCHEMA[nombreTabla];
    if (!esquemaColumnas) throw new Error(`[DAO INSERT] No hay esquema definido para ${nombreTabla}.`);

    // 2. Transformar el Array de Objetos JSON a Matriz 2D según el esquema
    const matrizInsertar = arrayRegistros.map(registroObj => {
      return esquemaColumnas.map(columna => {
        // Si el objeto no tiene la propiedad, insertamos vacío para no desfasar columnas
        return registroObj[columna] !== undefined ? registroObj[columna] : "";
      });
    });

    // 3. Escritura Atómica
    const startRow = sheet.getLastRow() + 1;
    const numRows = matrizInsertar.length;
    const numCols = esquemaColumnas.length;

    sheet.getRange(startRow, 1, numRows, numCols).setValues(matrizInsertar);
    
    Logger.log(`[EXITO] Insertados ${numRows} registros en ${nombreTabla}.`);
    return true;

  }, `Insertar_Tabla_${nombreTabla}`);
}

// ============================================================================
// 3. ACTUALIZACIÓN / ELIMINACIÓN ATÓMICA EN BLOQUE (Update/Delete)
// ============================================================================

/**
 * Actualiza o elimina un registro específico reescribiendo la tabla en bloque.
 * @param {string} nombreTabla - 'APP_CATALOGOS'.
 * @param {string} nombreColumnaId - 'id_catalogo'.
 * @param {string} idRegistro - El ID a buscar.
 * @param {Object|null} nuevosDatos - Si es null, elimina el registro. Si es objeto, actualiza.
 */
function modificarRegistroAtomico(nombreTabla, nombreColumnaId, idRegistro, nuevosDatos) {
  return ejecutarConReintentos(() => {
    // Usamos un Lock estricto para evitar que dos usuarios sobrescriban la tabla al mismo tiempo
    const lock = LockService.getScriptLock();
    lock.waitLock(15000); 

    try {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreTabla);
      const data = sheet.getDataRange().getValues();
      if (data.length <= 1) throw new Error("La tabla está vacía.");

      const headers = data[0];
      const indexId = headers.indexOf(nombreColumnaId);
      if (indexId === -1) throw new Error(`Columna ${nombreColumnaId} no encontrada.`);

      let filaModificada = false;
      let nuevaMatriz = [headers];

      // Procesar en memoria
      for (let i = 1; i < data.length; i++) {
        let row = data[i];
        if (row[indexId] === idRegistro) {
          if (nuevosDatos === null) {
            // ELIMINAR: Simplemente no lo agregamos a la nuevaMatriz
            filaModificada = true;
            continue; 
          } else {
            // ACTUALIZAR: Mapeamos los nuevos valores respetando el orden de las cabeceras
            let updatedRow = headers.map((col, idx) => nuevosDatos[col] !== undefined ? nuevosDatos[col] : row[idx]);
            nuevaMatriz.push(updatedRow);
            filaModificada = true;
          }
        } else {
          nuevaMatriz.push(row);
        }
      }

      if (!filaModificada) throw new Error("Registro no encontrado.");

      // Escritura atómica: Borrar contenido antiguo y escribir el nuevo bloque de golpe
      sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearContent();
      sheet.getRange(1, 1, nuevaMatriz.length, headers.length).setValues(nuevaMatriz);

      return true;
    } finally {
      lock.releaseLock();
    }
  }, `Modificar_Atomico_${nombreTabla}`);
}

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
