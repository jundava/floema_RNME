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
    item.origen = "Floema"; // Forzamos origen local
    item.estado = item.estado || "ACTIVO";
    
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

// ============================================================================
// PRODUCCIÓN: MOTOR EAV (CONSTRUCTOR DE FORMULARIOS) - ADAPTADO A ESTRUCTURA
// ============================================================================

function apiGuardarConfiguracionEAV(payload) {
  try {
    const idTramite = payload.tramite.id_tramite;
    const sheetPlantillas = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CFG_PLANTILLAS");
    const sheetCriterios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CFG_CRITERIOS");

    let dataPlantillas = sheetPlantillas.getDataRange().getValues();
    let headersPlantillas = dataPlantillas[0];
    let idxIdPlantilla = headersPlantillas.indexOf("id_plantilla");
    let idxIdTramite = headersPlantillas.indexOf("id_tramite");

    let idPlantillaActual = null;
    for (let i = 1; i < dataPlantillas.length; i++) {
      if (dataPlantillas[i][idxIdTramite] === idTramite) {
        idPlantillaActual = dataPlantillas[i][idxIdPlantilla];
        break; 
      }
    }

    if (!idPlantillaActual) {
      idPlantillaActual = "PLT-" + new Date().getTime();
      let nuevaFila = new Array(headersPlantillas.length).fill("");
      nuevaFila[idxIdPlantilla] = idPlantillaActual;
      nuevaFila[idxIdTramite] = idTramite;
      let idxFecha = headersPlantillas.indexOf("fecha_creacion");
      if(idxFecha !== -1) nuevaFila[idxFecha] = new Date().toISOString();
      let idxEstado = headersPlantillas.indexOf("estado");
      if(idxEstado !== -1) nuevaFila[idxEstado] = "Activo";
      sheetPlantillas.appendRow(nuevaFila);
    }

    let dataCriterios = sheetCriterios.getDataRange().getValues();
    let headersCriterios = dataCriterios[0];
    let idxCritIdPlantilla = headersCriterios.indexOf("id_plantilla");

    for (let i = dataCriterios.length - 1; i >= 1; i--) {
      if (dataCriterios[i][idxCritIdPlantilla] === idPlantillaActual) {
        sheetCriterios.deleteRow(i + 1); 
      }
    }

    if (payload.criterios && payload.criterios.length > 0) {
      payload.criterios.forEach((crit, index) => {
        let filaCrit = new Array(headersCriterios.length).fill("");

        let iIdCriterio = headersCriterios.indexOf("id_criterio");
        let iIdPlan = headersCriterios.indexOf("id_plantilla");
        let iTipo = headersCriterios.indexOf("tipo_input");
        let iEtiq = headersCriterios.indexOf("etiqueta_pregunta");
        let iOpc = headersCriterios.indexOf("opciones_json");
        let iPeso = headersCriterios.indexOf("peso");
        let iOblig = headersCriterios.indexOf("es_obligatorio");
        let iOrd = headersCriterios.indexOf("orden");
        let iAncho = headersCriterios.indexOf("ancho");
        let iEstado = headersCriterios.indexOf("estado_activo");
        let iMost = headersCriterios.indexOf("mostrar_en_tabla"); // <--- NUEVO

        if(iIdCriterio !== -1) filaCrit[iIdCriterio] = "CRT-" + new Date().getTime() + "-" + index;
        if(iIdPlan !== -1) filaCrit[iIdPlan] = idPlantillaActual;
        if(iTipo !== -1) filaCrit[iTipo] = crit.tipo_input || "texto";
        if(iEtiq !== -1) filaCrit[iEtiq] = crit.etiqueta_pregunta || "Sin Título";
        if(iOpc !== -1) filaCrit[iOpc] = crit.opciones_json || "";
        if(iPeso !== -1) filaCrit[iPeso] = crit.peso || 1; 
        if(iOblig !== -1) filaCrit[iOblig] = crit.es_obligatorio !== undefined ? crit.es_obligatorio : true;
        if(iOrd !== -1) filaCrit[iOrd] = index + 1; 
        if(iAncho !== -1) filaCrit[iAncho] = crit.ancho || "col-md-12"; 
        if(iEstado !== -1) filaCrit[iEstado] = true;
        if(iMost !== -1) filaCrit[iMost] = crit.mostrar_en_tabla === true; // <--- NUEVO

        sheetCriterios.appendRow(filaCrit);
      });
    }
    return { success: true, id_plantilla: idPlantillaActual };
  } catch (error) {
    throw new Error("Fallo en el servidor al guardar: " + error.message);
  }
}

function apiObtenerCriteriosTramite(id_tramite) {
  try {
    const sheetPlantillas = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CFG_PLANTILLAS");
    const sheetCriterios = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CFG_CRITERIOS");

    let dataPlantillas = sheetPlantillas.getDataRange().getValues();
    let headersPlantillas = dataPlantillas[0];
    let idxIdPlantilla = headersPlantillas.indexOf("id_plantilla");
    let idxIdTramite = headersPlantillas.indexOf("id_tramite");

    let idPlantillaActual = null;
    for (let i = 1; i < dataPlantillas.length; i++) {
      if (dataPlantillas[i][idxIdTramite] === id_tramite) {
        idPlantillaActual = dataPlantillas[i][idxIdPlantilla];
        break;
      }
    }

    if (!idPlantillaActual) return { criterios: [] };

    let dataCriterios = sheetCriterios.getDataRange().getValues();
    let headersCriterios = dataCriterios[0];
    let idxCritIdPlantilla = headersCriterios.indexOf("id_plantilla");
    
    let idxIdCriterio = headersCriterios.indexOf("id_criterio"); 
    let idxEtiqueta = headersCriterios.indexOf("etiqueta_pregunta");
    let idxTipo = headersCriterios.indexOf("tipo_input");
    let idxOpciones = headersCriterios.indexOf("opciones_json");
    let idxOrden = headersCriterios.indexOf("orden");
    let idxAncho = headersCriterios.indexOf("ancho");
    let idxMost = headersCriterios.indexOf("mostrar_en_tabla"); // <--- NUEVO

    let preguntas = [];
    for (let i = 1; i < dataCriterios.length; i++) {
      if (dataCriterios[i][idxCritIdPlantilla] === idPlantillaActual) {
        preguntas.push({
          id_criterio: String(dataCriterios[i][idxIdCriterio] || ''), 
          id_plantilla: idPlantillaActual,
          etiqueta_pregunta: String(dataCriterios[i][idxEtiqueta] || ''),
          tipo_input: String(dataCriterios[i][idxTipo] || 'texto'),
          opciones_json: String(dataCriterios[i][idxOpciones] || ''),
          ancho: String(dataCriterios[i][idxAncho] || 'col-md-12'),
          mostrar_en_tabla: dataCriterios[i][idxMost] === true || String(dataCriterios[i][idxMost]).toLowerCase() === 'true', // <--- NUEVO
          orden: Number(dataCriterios[i][idxOrden] || 0)
        });
      }
    }
    preguntas.sort((a, b) => a.orden - b.orden);
    return { criterios: preguntas };
  } catch (error) {
    throw new Error("Fallo en el servidor al cargar: " + error.message);
  }
}

// ============================================================================
// ENDPOINTS DE TRÁMITES (CRUD PRINCIPAL CFG_TRAMITES)
// ============================================================================

/**
 * Guarda un nuevo trámite en la base de datos principal.
 */
function apiGuardarTramite(nombre_tramite) {
  return ejecutarConReintentos(() => {
    const nuevoTramite = {
      id_tramite: 'TRM-' + Utilities.getUuid().split('-')[0].toUpperCase(),
      nombre_tramite: nombre_tramite.trim().toUpperCase(),
      estado_activo: true
    };
    
    // Asegúrate de tener una pestaña llamada CFG_TRAMITES en tu Google Sheet
    insertarEnTabla("CFG_TRAMITES", [nuevoTramite]);
    
    return { success: true, tramite: nuevoTramite };
  }, "Guardar_Tramite");
}

/**
 * Elimina un trámite de la base de datos.
 */
function apiEliminarTramite(id_tramite) {
  // Utilizamos la función atómica que ya construimos en Modelo.gs
  modificarRegistroAtomico("CFG_TRAMITES", "id_tramite", id_tramite, null);
  return { success: true };
}

// ============================================================================
// PRODUCCIÓN: MÓDULO DE EVALUACIÓN (ADAPTADO A TU ESTRUCTURA EXACTA)
// ============================================================================

function apiGuardarEvaluacionCompleta(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetEval = ss.getSheetByName("DAT_EVALUACIONES");
    const sheetResp = ss.getSheetByName("DAT_RESPUESTAS");

    if (!sheetEval || !sheetResp) throw new Error("Faltan hojas DAT_EVALUACIONES o DAT_RESPUESTAS");

    const idEvaluacion = "EVL-" + new Date().getTime();
    
    // 1. GUARDAR CABECERA (Tu estructura DAT_EVALUACIONES)
    let headersEval = sheetEval.getDataRange().getValues()[0];
    let filaEval = new Array(headersEval.length).fill("");
    
    let iIdEval = headersEval.indexOf("id_evaluacion");
    let iIdExp = headersEval.indexOf("id_expediente");
    let iIdPlan = headersEval.indexOf("id_plantilla");
    let iEmail = headersEval.indexOf("email_evaluador");
    let iFecha = headersEval.indexOf("fecha_evaluacion");
    let iPtos = headersEval.indexOf("puntuacion_total");
    let iObs = headersEval.indexOf("observaciones");

    if(iIdEval !== -1) filaEval[iIdEval] = idEvaluacion;
    if(iIdExp !== -1) filaEval[iIdExp] = payload.id_expediente || "S/N";
    if(iIdPlan !== -1) filaEval[iIdPlan] = payload.id_plantilla;
    if(iEmail !== -1) filaEval[iEmail] = Session.getActiveUser().getEmail() || "usuario_local";
    if(iFecha !== -1) filaEval[iFecha] = new Date().toISOString();
    if(iPtos !== -1) filaEval[iPtos] = payload.puntuacion_total || 0;
    if(iObs !== -1) filaEval[iObs] = payload.observaciones || "";

    sheetEval.appendRow(filaEval);

    // 2. GUARDAR RESPUESTAS (Tu estructura DAT_RESPUESTAS)
    let headersResp = sheetResp.getDataRange().getValues()[0];
    
    if (payload.respuestas && payload.respuestas.length > 0) {
      payload.respuestas.forEach((resp, index) => {
        let filaResp = new Array(headersResp.length).fill("");
        
        let iIdResp = headersResp.indexOf("id_respuesta");
        let iIdEvR = headersResp.indexOf("id_evaluacion");
        let iIdCrit = headersResp.indexOf("id_criterio");
        let iVal = headersResp.indexOf("valor_respuesta");
        let iEvi = headersResp.indexOf("id_evidencia_drive");

        if(iIdResp !== -1) filaResp[iIdResp] = "RSP-" + new Date().getTime() + "-" + index;
        if(iIdEvR !== -1) filaResp[iIdEvR] = idEvaluacion;
        if(iIdCrit !== -1) filaResp[iIdCrit] = resp.id_criterio;
        
        // Si es un archivo, lo guardamos en la columna de drive, sino en valor_respuesta
        if (resp.es_archivo) {
          if(iEvi !== -1) filaResp[iEvi] = resp.valor;
        } else {
          if(iVal !== -1) filaResp[iVal] = resp.valor;
        }

        sheetResp.appendRow(filaResp);
      });
    }

    return { success: true, id_evaluacion: idEvaluacion };
  } catch (error) {
    throw new Error("Fallo al guardar: " + error.message);
  }
}

function apiObtenerEvaluacionesPorTramite(id_tramite) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetPlantillas = ss.getSheetByName("CFG_PLANTILLAS");
    const sheetEval = ss.getSheetByName("DAT_EVALUACIONES");
    const sheetResp = ss.getSheetByName("DAT_RESPUESTAS"); // NUEVO
    const sheetCrit = ss.getSheetByName("CFG_CRITERIOS"); // NUEVO
    
    if (!sheetPlantillas || !sheetEval) return { success: true, evaluaciones: [], columnasDinamicas: [] };

    const dataPlan = sheetPlantillas.getDataRange().getValues();
    let idxPlanIdPlan = dataPlan[0].indexOf("id_plantilla");
    let idxPlanIdTram = dataPlan[0].indexOf("id_tramite");
    
    let plantillasDelTramite = [];
    let idPlantillaMasReciente = null;
    for (let i = 1; i < dataPlan.length; i++) {
      if (dataPlan[i][idxPlanIdTram] === id_tramite) {
        plantillasDelTramite.push(dataPlan[i][idxPlanIdPlan]);
        idPlantillaMasReciente = dataPlan[i][idxPlanIdPlan];
      }
    }

    // A. OBTENER QUÉ COLUMNAS SE DEBEN MOSTRAR
    let columnasDinamicas = [];
    if (sheetCrit && idPlantillaMasReciente) {
      const dataCrit = sheetCrit.getDataRange().getValues();
      let idxCritIdPlan = dataCrit[0].indexOf("id_plantilla");
      let idxCritIdCrit = dataCrit[0].indexOf("id_criterio");
      let idxCritEtiq = dataCrit[0].indexOf("etiqueta_pregunta");
      let idxCritMost = dataCrit[0].indexOf("mostrar_en_tabla");
      
      if(idxCritMost !== -1) {
        for (let i = 1; i < dataCrit.length; i++) {
          if (dataCrit[i][idxCritIdPlan] === idPlantillaMasReciente) {
            let mostrar = dataCrit[i][idxCritMost] === true || String(dataCrit[i][idxCritMost]).toLowerCase() === 'true';
            if (mostrar) {
              columnasDinamicas.push({
                id_criterio: String(dataCrit[i][idxCritIdCrit] || ''),
                etiqueta_pregunta: String(dataCrit[i][idxCritEtiq] || '')
              });
            }
          }
        }
      }
    }

    // B. OBTENER LAS EVALUACIONES
    const dataEval = sheetEval.getDataRange().getValues();
    const headEval = dataEval[0];
    
    const idxIdEval = headEval.indexOf("id_evaluacion");
    const idxIdExp = headEval.indexOf("id_expediente");
    const idxIdPlan = headEval.indexOf("id_plantilla");
    const idxFecha = headEval.indexOf("fecha_evaluacion");
    const idxEmail = headEval.indexOf("email_evaluador");
    const idxPtos = headEval.indexOf("puntuacion_total");
    const idxObs = headEval.indexOf("observaciones"); 

    let evalMap = {};
    for (let i = 1; i < dataEval.length; i++) {
      if (plantillasDelTramite.includes(dataEval[i][idxIdPlan])) {
        let idEv = String(dataEval[i][idxIdEval] || '');
        evalMap[idEv] = {
          id_evaluacion: idEv,
          id_expediente: String(dataEval[i][idxIdExp] || ''),
          fecha_evaluacion: String(dataEval[i][idxFecha] || ''),
          email_evaluador: String(dataEval[i][idxEmail] || ''),
          puntuacion_total: String(dataEval[i][idxPtos] || '0'),
          observaciones: String(dataEval[i][idxObs] || ''),
          respuestas: {} // Preparamos objeto de respuestas
        };
      }
    }

    // C. OBTENER LAS RESPUESTAS ASOCIADAS A LAS COLUMNAS DINÁMICAS
    if (sheetResp && columnasDinamicas.length > 0) {
      const dataResp = sheetResp.getDataRange().getValues();
      const headResp = dataResp[0];
      const idxRespIdEval = headResp.indexOf("id_evaluacion");
      const idxRespIdCrit = headResp.indexOf("id_criterio");
      const idxRespValor = headResp.indexOf("valor_respuesta");

      for (let i = 1; i < dataResp.length; i++) {
        let idEv = String(dataResp[i][idxRespIdEval]);
        if (evalMap[idEv]) {
          let idCr = String(dataResp[i][idxRespIdCrit]);
          evalMap[idEv].respuestas[idCr] = String(dataResp[i][idxRespValor] || '');
        }
      }
    }

    let evaluaciones = Object.values(evalMap);
    evaluaciones.sort((a, b) => new Date(b.fecha_evaluacion) - new Date(a.fecha_evaluacion));
    
    // Devolvemos las evaluaciones Y las columnas a dibujar
    return { success: true, evaluaciones: evaluaciones, columnasDinamicas: columnasDinamicas };
  } catch (error) {
    return { success: false, evaluaciones: [], columnasDinamicas: [] };
  }
}

