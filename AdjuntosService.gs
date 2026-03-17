/**
 * @fileoverview Endpoint: Subida de archivos adjuntos desde el formulario de evaluación.
 * Agregar este bloque al final de Controladores.gs (o en un archivo aparte, ej. AdjuntosService.gs).
 *
 * FLUJO:
 *   Frontend (campo tipo "adjuntar")
 *     └─ Lee el archivo como Base64 (FileReader)
 *     └─ Llama a google.script.run → apiSubirEvidencia(payload)
 *          └─ DriveService.gs → guardarAdjuntoEvaluacion(payload)
 *               └─ Crea carpeta ROOT/tramite/expediente si no existe
 *               └─ Sube el archivo y retorna el Drive File ID
 *     └─ Almacena el File ID en DAT_RESPUESTAS.id_evidencia_drive
 */

// ============================================================================
// ENDPOINT PRINCIPAL — llamado desde google.script.run en el Frontend
// ============================================================================

/**
 * Recibe un archivo en Base64 desde el campo "adjuntar" del formulario de evaluación,
 * lo valida y delega la subida a DriveService.
 *
 * @param {Object} payload
 * @param {string} payload.base64        - Contenido del archivo en Base64 puro (sin cabecera data:...).
 * @param {string} payload.nombreArchivo - Nombre original del archivo (ej. "informe.pdf").
 * @param {string} payload.mimeType      - MIME type reportado por el navegador.
 * @param {string} payload.nombreTramite - Nombre del trámite activo (para determinar carpeta en Drive).
 * @param {string} payload.idExpediente  - ID del expediente ingresado en el formulario.
 *
 * @returns {{ success: boolean, fileId: string, nombre: string }}
 */
function apiSubirEvidencia(payload) {
  // 1. Validaciones de entrada (primera línea de defensa en el servidor)
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload inválido.');
  }
  if (!payload.base64 || payload.base64.trim() === '') {
    throw new Error('El contenido del archivo está vacío.');
  }
  if (!payload.nombreArchivo || payload.nombreArchivo.trim() === '') {
    throw new Error('El nombre del archivo es obligatorio.');
  }
  if (!payload.mimeType) {
    throw new Error('El tipo de archivo (mimeType) es obligatorio.');
  }
  if (!payload.nombreTramite || payload.nombreTramite.trim() === '') {
    throw new Error('El nombre del trámite es obligatorio para determinar la carpeta de destino.');
  }
  if (!payload.idExpediente || payload.idExpediente.trim() === '') {
    throw new Error('El ID del expediente es obligatorio para determinar la carpeta de destino.');
  }

  // 2. Sanitizar el nombre del archivo (eliminar caracteres problemáticos para Drive)
  const nombreSeguro = payload.nombreArchivo
    .replace(/[\/\\:*?"<>|]/g, '_')  // caracteres prohibidos en nombres de archivo
    .trim();

  // 3. Llamar al servicio de Drive
  return guardarAdjuntoEvaluacion({
    base64:        payload.base64,
    nombreArchivo: nombreSeguro,
    mimeType:      payload.mimeType,
    nombreTramite: payload.nombreTramite.trim(),
    idExpediente:  payload.idExpediente.trim()
  });
}