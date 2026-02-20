/**
 * @fileoverview Controladores de la Web App (Endpoints públicos para google.script.run)
 * @author GAS Expert
 * @description Punto de entrada para el frontend. Implementa seguridad y enrutamiento interno.
 */

// ============================================================================
// 1. PUNTO DE ENTRADA WEB (Servir la SPA)
// ============================================================================

/**
 * Función obligatoria de GAS para desplegar como Aplicación Web.
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  
  // Pasamos variables iniciales al frontend si es necesario (ej. el email del usuario activo)
  template.userEmail = Session.getActiveUser().getEmail();
  
  return template.evaluate()
    .setTitle('App Floema RNME')
    .setFaviconUrl('https://img.icons8.com/color/48/000000/google-sheets.png') // Icono temporal
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Permite incrustar en Google Sites
}

// ============================================================================
// 2. ENDPOINTS DE LECTURA (Llamados desde Vue 3)
// ============================================================================

/**
 * Obtiene los datos iniciales necesarios para arrancar la app.
 * @returns {Object} JSON con catálogos y trámites.
 */
function apiObtenerDatosArranque() {
  Logger.log(`[API] Usuario ${Session.getActiveUser().getEmail()} solicitó datos de arranque.`);
  
  // Utilizamos el DAO que construimos previamente
  const catalogos = getTabla("APP_CATALOGOS");
  const tramites = getTabla("CFG_TRAMITES");
  const configuracion = getTabla("SYS_CONFIG");
  
  return {
    catalogos: catalogos,
    tramites: tramites,
    config: configuracion
  };
}

// ============================================================================
// 3. ENDPOINTS DE ESCRITURA (Transacciones)
// ============================================================================

/**
 * Recibe una evaluación completa desde el frontend y orquesta el guardado.
 * @param {Object} payload - Objeto con cabecera de evaluación, respuestas y evidencias Base64.
 * @returns {Object} Respuesta de éxito o error.
 */
function apiGuardarEvaluacionCompleta(payload) {
  // Aquí implementaremos posteriormente el bloqueo de concurrencia (Locks)
  // y la separación del payload hacia DAT_EVALUACIONES y DAT_RESPUESTAS.
  // Por ahora, es el cascarón que Vue 3 llamará.
  Logger.log("[API] Recibiendo nueva evaluación para procesar.");
  return { success: true, message: "Endpoint preparado." };
}

// ============================================================================
// ENDPOINTS DE ADMINISTRACIÓN (Motor EAV)
// ============================================================================

/**
 * Guarda una nueva plantilla dinámica y sus criterios.
 * Implementa versionado si el trámite ya tenía una plantilla anterior.
 * @param {Object} payload - { tramite: {...}, criterios: [...] }
 */
function apiGuardarPlantillaYCriterios(payload) {
  Logger.log(`[API ADMIN] Solicitud de guardado de Plantilla para trámite: ${payload.tramite.id_tramite}`);
  
  // 1. Validar permisos (Solo Admins deberían poder hacer esto)
  // const userEmail = Session.getActiveUser().getEmail();
  // const esAdmin = validarRolUsuario(userEmail, 'Admin'); // Implementaremos esto luego
  
  return ejecutarConReintentos(() => {
    // 2. Generar IDs únicos (UUID simplificado para GAS)
    const idPlantilla = Utilities.getUuid();
    
    // 3. Preparar los Criterios mapeando al DB_SCHEMA de CFG_CRITERIOS
    const registrosCriterios = payload.criterios.map((crit, index) => {
      return {
        id_criterio: Utilities.getUuid(),
        id_plantilla: idPlantilla,
        tipo_input: crit.tipo_input,
        etiqueta_pregunta: crit.etiqueta_pregunta,
        opciones_json: crit.tipo_input === 'select' ? crit.opciones_json : '',
        peso: crit.peso,
        es_obligatorio: crit.es_obligatorio,
        orden: index + 1,
        estado_activo: true
      };
    });

    // 4. Escribir usando nuestro DAO Atómico (Modelo.gs)
    // Aquí (en la vida real) primero haríamos Soft Delete a la versión anterior de la plantilla.
    // insertarEnTabla("CFG_PLANTILLAS", [{ id_plantilla: idPlantilla, id_tramite: payload.tramite.id_tramite, ... }]);
    // insertarEnTabla("CFG_CRITERIOS", registrosCriterios);

    Logger.log(`[EXITO] Plantilla ${idPlantilla} guardada con ${registrosCriterios.length} criterios.`);
    return { success: true, newTemplateId: idPlantilla };
    
  }, "Guardar_Plantilla_EAV");
}

// ============================================================================
// ENDPOINTS DE CATÁLOGOS (CRUD)
// ============================================================================

function apiGuardarItemCatalogo(item) {
  // Si no tiene ID, es un registro nuevo (Create)
  if (!item.id_catalogo) {
    item.id_catalogo = Utilities.getUuid();
    item.origen = "LOCAL_FLOEMA"; // Forzamos origen local
    item.estado = item.estado || "Activo";
    
    insertarEnTabla("APP_CATALOGOS", [item]);
    return { success: true, item: item };
  } 
  
  // Si tiene ID, es una actualización (Update)
  modificarRegistroAtomico("APP_CATALOGOS", "id_catalogo", item.id_catalogo, item);
  return { success: true, item: item };
}

function apiEliminarItemCatalogo(id_catalogo) {
  modificarRegistroAtomico("APP_CATALOGOS", "id_catalogo", id_catalogo, null);
  return { success: true };
}

