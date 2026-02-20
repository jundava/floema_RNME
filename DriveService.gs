/**
 * @fileoverview Servicio de Gestión Documental para Google Drive
 * @author GAS Expert
 * @description Crea jerarquías anti-duplicación y procesa subidas Base64 de forma segura.
 */

const DRIVE_CONFIG = {
  ROOT_FOLDER_ID: "1xwQBssJrN_iUbdO8yHCrhq-hFwN_w4fT",
  ALLOWED_MIME_TYPES: ["application/pdf", "image/jpeg", "image/png"],
  MAX_SIZE_MB: 5 // Límite estricto para evitar Timeouts de GAS
};

// ============================================================================
// 1. MOTOR DE ENRUTAMIENTO Y ANTI-DUPLICACIÓN DE CARPETAS
// ============================================================================

/**
 * Busca una carpeta por nombre dentro de un padre. Si no existe, la crea de forma atómica.
 * @param {GoogleAppsScript.Drive.Folder} parentFolder - Objeto Folder padre.
 * @param {string} folderName - Nombre de la carpeta a buscar/crear.
 * @returns {GoogleAppsScript.Drive.Folder} El objeto de la carpeta solicitada.
 */
function obtenerOCrearCarpeta(parentFolder, folderName) {
  return ejecutarConReintentos(() => {
    const folders = parentFolder.getFoldersByName(folderName);
    if (folders.hasNext()) {
      return folders.next(); // Ya existe, la reutilizamos
    } else {
      Logger.log(`[DRIVE] Creando nueva subcarpeta: ${folderName}`);
      return parentFolder.createFolder(folderName); // No existe, la creamos
    }
  }, `Generar_Carpeta_${folderName}`);
}

/**
 * Resuelve y construye la ruta jerárquica completa para un expediente.
 * @param {string} nombreTramite - Ej. 'Evaluacion_Maquinaria'.
 * @param {string} idEmpresa - Ej. 'EMP-001'.
 * @param {string} idExpediente - Ej. 'EXP-2026-0001'.
 * @returns {GoogleAppsScript.Drive.Folder} La carpeta final del expediente.
 */
function resolverRutaExpediente(nombreTramite, idEmpresa, idExpediente) {
  return ejecutarConReintentos(() => {
    const rootFolder = DriveApp.getFolderById(DRIVE_CONFIG.ROOT_FOLDER_ID);
    
    // Nivel 1: Trámite
    const folderTramite = obtenerOCrearCarpeta(rootFolder, nombreTramite);
    
    // Nivel 2: Empresa
    const folderEmpresa = obtenerOCrearCarpeta(folderTramite, idEmpresa);
    
    // Nivel 3: Expediente
    const folderExpediente = obtenerOCrearCarpeta(folderEmpresa, idExpediente);
    
    return folderExpediente;
  }, `Resolver_Ruta_Expediente_${idExpediente}`);
}

// ============================================================================
// 2. PROCESAMIENTO DE EVIDENCIAS (Subida Base64)
// ============================================================================

/**
 * Recibe un archivo en Base64 desde Vue 3 y lo inyecta en la carpeta correcta de Drive.
 * @param {Object} payload - Objeto con { base64, nombreArchivo, mimeType, tramite, idEmpresa, idExpediente }
 * @returns {string} El ID del archivo generado en Google Drive (para guardarlo en DAT_RESPUESTAS).
 */
function guardarEvidenciaDrive(payload) {
  const { base64, nombreArchivo, mimeType, tramite, idEmpresa, idExpediente } = payload;

  // 1. Validación de Seguridad Estricta
  if (!DRIVE_CONFIG.ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`[SEGURIDAD] Tipo de archivo no permitido: ${mimeType}`);
  }

  return ejecutarConReintentos(() => {
    // 2. Decodificar Base64 a Blob
    // El frontend envía la cadena limpia sin la cabecera "data:image/png;base64,"
    const decodedData = Utilities.base64Decode(base64);
    const blob = Utilities.newBlob(decodedData, mimeType, nombreArchivo);

    // Validación de peso aprox (1 byte por elemento del array decodificado)
    const sizeInMB = decodedData.length / (1024 * 1024);
    if (sizeInMB > DRIVE_CONFIG.MAX_SIZE_MB) {
      throw new Error(`[LÍMITE] El archivo excede los ${DRIVE_CONFIG.MAX_SIZE_MB}MB permitidos.`);
    }

    // 3. Obtener carpeta destino y guardar
    const folderDestino = resolverRutaExpediente(tramite, idEmpresa, idExpediente);
    const file = folderDestino.createFile(blob);
    
    Logger.log(`[EXITO] Archivo ${nombreArchivo} guardado con ID: ${file.getId()}`);
    return file.getId(); // Este ID es el que se almacenará en el campo id_evidencia_drive
    
  }, `Guardar_Evidencia_${nombreArchivo}`);
}