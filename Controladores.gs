/**
 * @fileoverview Controladores de la Web App
 */

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  template.userEmail = Session.getActiveUser().getEmail();
  return template.evaluate()
    .setTitle('App Floema RNME')
    .setFaviconUrl('https://img.icons8.com/color/48/000000/google-sheets.png')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Obtiene los datos iniciales necesarios para arrancar la app.
 * Ahora incluye la integración dinámica con otros sistemas (Empresas y Equipos).
 */
function apiObtenerDatosArranque() {
  let catalogos = getTabla("APP_CATALOGOS") || [];
  const tramites = getTabla("CFG_TRAMITES") || [];
  const configuracion = getTabla("SYS_CONFIG") || [];

  try {
    // 1. Inyectar DAT_EMPRESAS como catálogo dinámico
    const empresas = getTabla("DAT_EMPRESAS") || [];
    empresas.forEach(emp => {
      if (emp.razon_social) {
        catalogos.push({
          id_catalogo: "SYS-EMP-" + (emp.id_empresa || new Date().getTime()),
          categoria: "EMPRESAS_EXTERNAS",
          valor: String(emp.razon_social),
          estado: "Activo",
          origen: "Sistema Externo"
        });
      }
    });

    // 2. Inyectar DAT_EQUIPOS como catálogo dinámico
    const equipos = getTabla("DAT_EQUIPOS") || [];
    equipos.forEach(eq => {
      if (eq.descripcion) {
        catalogos.push({
          id_catalogo: "SYS-EQ-" + (eq.id_equipo || new Date().getTime()),
          categoria: "EQUIPOS_EXTERNOS",
          valor: String(eq.descripcion),
          estado: "Activo",
          origen: "Sistema Externo"
        });
      }
    });
  } catch (e) {
    Logger.log("Aviso: Las tablas DAT_EMPRESAS o DAT_EQUIPOS no existen aún. Ignorando integración externa.");
  }

  return { catalogos, tramites, config: configuracion };
}

// ============================================================================
// ENDPOINTS DE CATÁLOGOS Y TRÁMITES
// ============================================================================
function apiGuardarItemCatalogo(item) {
  if (!item.id_catalogo) {
    item.id_catalogo = Utilities.getUuid();
    item.origen = "Floema";
    item.estado = item.estado || "ACTIVO";
    insertarEnTabla("APP_CATALOGOS", [item]);
    return { success: true, item: item };
  } 
  modificarRegistroAtomico("APP_CATALOGOS", "id_catalogo", item.id_catalogo, item);
  return { success: true, item: item };
}

function apiEliminarItemCatalogo(id_catalogo) {
  modificarRegistroAtomico("APP_CATALOGOS", "id_catalogo", id_catalogo, null);
  return { success: true };
}

function apiGuardarTramite(nombre_tramite) {
  return ejecutarConReintentos(() => {
    const nuevoTramite = {
      id_tramite: 'TRM-' + Utilities.getUuid().split('-')[0].toUpperCase(),
      nombre_tramite: nombre_tramite.trim().toUpperCase(),
      estado_activo: true
    };
    insertarEnTabla("CFG_TRAMITES", [nuevoTramite]);
    return { success: true, tramite: nuevoTramite };
  }, "Guardar_Tramite");
}

function apiEliminarTramite(id_tramite) {
  modificarRegistroAtomico("CFG_TRAMITES", "id_tramite", id_tramite, null);
  return { success: true };
}

// ============================================================================
// MOTOR EAV (DISEÑADOR DE PLANTILLAS)
// ============================================================================
function apiGuardarConfiguracionEAV(payload) {
  try {
    const idTramite = payload.tramite.id_tramite;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetPlantillas = ss.getSheetByName("CFG_PLANTILLAS");
    const sheetCriterios = ss.getSheetByName("CFG_CRITERIOS");

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
      
      let idxFecha = headersPlantillas.indexOf("fecha_vigencia"); 
      if(idxFecha !== -1) nuevaFila[idxFecha] = new Date().toISOString();
      
      let idxEstado = headersPlantillas.indexOf("estado_activo");
      if(idxEstado !== -1) nuevaFila[idxEstado] = true;
      
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
        let iMost = headersCriterios.indexOf("mostrar_en_tabla"); 

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
        if(iMost !== -1) filaCrit[iMost] = crit.mostrar_en_tabla === true; 

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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetPlantillas = ss.getSheetByName("CFG_PLANTILLAS");
    const sheetCriterios = ss.getSheetByName("CFG_CRITERIOS");

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
    let idxMost = headersCriterios.indexOf("mostrar_en_tabla"); 

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
          mostrar_en_tabla: dataCriterios[i][idxMost] === true || String(dataCriterios[i][idxMost]).toLowerCase() === 'true',
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
// MÓDULO DE EVALUACIÓN (OPERACIÓN) - CREATE, READ & UPDATE
// ============================================================================

// 1. MODIFICADO: Ahora trae las respuestas Y el Snapshot (la foto del formulario)
function apiObtenerDetalleEvaluacion(id_evaluacion) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetResp = ss.getSheetByName("DAT_RESPUESTAS");
    const sheetEval = ss.getSheetByName("DAT_EVALUACIONES"); // Necesitamos leer la cabecera
    
    if (!sheetResp || !sheetEval) return { success: false };

    // A. Obtener el Snapshot de la Plantilla
    let snapshot = [];
    const dataEval = sheetEval.getDataRange().getValues();
    let headEval = dataEval[0].map(h => String(h).trim().toLowerCase());
    const idxIdEvalCab = headEval.indexOf("id_evaluacion");
    const idxSnap = headEval.indexOf("snapshot_plantilla");
    
    for (let i = 1; i < dataEval.length; i++) {
      if (String(dataEval[i][idxIdEvalCab]) === id_evaluacion) {
         if (idxSnap !== -1 && dataEval[i][idxSnap]) {
           try { snapshot = JSON.parse(dataEval[i][idxSnap]); } catch(e) {}
         }
         break;
      }
    }

    // B. Obtener las Respuestas
    let respuestas = {};
    const dataResp = sheetResp.getDataRange().getValues();
    if (dataResp.length > 1) {
      let headResp = dataResp[0].map(h => String(h).trim().toLowerCase());
      const idxIdEval = headResp.indexOf("id_evaluacion");
      const idxIdCrit = headResp.indexOf("id_criterio");
      const idxValor = headResp.indexOf("valor_respuesta");
      const idxEvi = headResp.indexOf("id_evidencia_drive");

      for (let i = 1; i < dataResp.length; i++) {
        if (String(dataResp[i][idxIdEval]) === id_evaluacion) {
          let idCrit = String(dataResp[i][idxIdCrit]);
          let valorNormal = idxValor !== -1 ? String(dataResp[i][idxValor] || '') : '';
          let valorFile = idxEvi !== -1 ? String(dataResp[i][idxEvi] || '') : '';
          respuestas[idCrit] = valorFile || valorNormal; 
        }
      }
    }
    
    return { success: true, respuestas: respuestas, snapshot: snapshot };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// 2. MODIFICADO: Ahora guarda el Snapshot al crear o actualizar
function apiGuardarEvaluacionCompleta(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetEval = ss.getSheetByName("DAT_EVALUACIONES");
    const sheetResp = ss.getSheetByName("DAT_RESPUESTAS");

    if (!sheetEval || !sheetResp) throw new Error("Faltan hojas DAT_EVALUACIONES o DAT_RESPUESTAS");

    const esActualizacion = !!payload.id_evaluacion;
    const idEvaluacion = esActualizacion ? payload.id_evaluacion : "EVL-" + new Date().getTime();
    
    // --- 1. CABECERA (DAT_EVALUACIONES) ---
    let dataEval = sheetEval.getDataRange().getValues();
    let headEval = dataEval[0].map(h => String(h).trim().toLowerCase());
    
    let iIdEval = headEval.indexOf("id_evaluacion");
    let iIdExp = headEval.indexOf("id_expediente");
    let iIdPlan = headEval.indexOf("id_plantilla");
    let iEmail = headEval.indexOf("email_evaluador");
    let iFecha = headEval.indexOf("fecha_evaluacion");
    let iPtos = headEval.indexOf("puntuacion_total");
    let iObs = headEval.indexOf("observaciones");
    let iSnap = headEval.indexOf("snapshot_plantilla"); // NUEVO

    // Preparar el string del snapshot
    const snapshotString = JSON.stringify(payload.criterios_snapshot || []);

    if (esActualizacion) {
      let filaEncontrada = false;
      for (let i = 1; i < dataEval.length; i++) {
        if (String(dataEval[i][iIdEval]) === idEvaluacion) {
          if (iIdExp !== -1) sheetEval.getRange(i + 1, iIdExp + 1).setValue(payload.id_expediente || "S/N");
          if (iObs !== -1) sheetEval.getRange(i + 1, iObs + 1).setValue(payload.observaciones || "");
          if (iFecha !== -1) sheetEval.getRange(i + 1, iFecha + 1).setValue(new Date().toISOString());
          if (iEmail !== -1) sheetEval.getRange(i + 1, iEmail + 1).setValue(Session.getActiveUser().getEmail() || "usuario_local");
          if (iPtos !== -1) sheetEval.getRange(i + 1, iPtos + 1).setValue(payload.puntuacion_total || 0);
          if (iSnap !== -1) sheetEval.getRange(i + 1, iSnap + 1).setValue(snapshotString); // Actualiza la foto
          filaEncontrada = true;
          break;
        }
      }
      if (!filaEncontrada) throw new Error("La evaluación a editar no existe.");
    } else {
      let filaEval = new Array(headEval.length).fill("");
      if(iIdEval !== -1) filaEval[iIdEval] = idEvaluacion;
      if(iIdExp !== -1) filaEval[iIdExp] = payload.id_expediente || "S/N";
      if(iIdPlan !== -1) filaEval[iIdPlan] = payload.id_plantilla;
      if(iEmail !== -1) filaEval[iEmail] = Session.getActiveUser().getEmail() || "usuario_local";
      if(iFecha !== -1) filaEval[iFecha] = new Date().toISOString();
      if(iPtos !== -1) filaEval[iPtos] = payload.puntuacion_total || 0;
      if(iObs !== -1) filaEval[iObs] = payload.observaciones || "";
      if(iSnap !== -1) filaEval[iSnap] = snapshotString; // Guarda la foto nueva
      sheetEval.appendRow(filaEval);
    }

    // --- 2. RESPUESTAS (DAT_RESPUESTAS) ---
    // (Esta sección se mantiene exactamente igual que en el código anterior que ya te pasé, 
    // manejando el borrado y reescritura atómica).
    let dataResp = sheetResp.getDataRange().getValues();
    let headResp = dataResp[0].map(h => String(h).trim().toLowerCase());
    
    let iIdResp = headResp.indexOf("id_respuesta");
    let iIdEvR = headResp.indexOf("id_evaluacion");
    let iIdCrit = headResp.indexOf("id_criterio");
    let iVal = headResp.indexOf("valor_respuesta");
    let iEvi = headResp.indexOf("id_evidencia_drive");

    if (esActualizacion) {
      let nuevasFilas = [dataResp[0]];
      for (let i = 1; i < dataResp.length; i++) {
        if (String(dataResp[i][iIdEvR]) !== idEvaluacion) { nuevasFilas.push(dataResp[i]); }
      }
      if (payload.respuestas && payload.respuestas.length > 0) {
        payload.respuestas.forEach((resp, index) => {
          let filaResp = new Array(headResp.length).fill("");
          if(iIdResp !== -1) filaResp[iIdResp] = "RSP-" + new Date().getTime() + "-" + index;
          if(iIdEvR !== -1) filaResp[iIdEvR] = idEvaluacion;
          if(iIdCrit !== -1) filaResp[iIdCrit] = resp.id_criterio;
          if (resp.es_archivo) { if(iEvi !== -1) filaResp[iEvi] = resp.valor; } 
          else { if(iVal !== -1) filaResp[iVal] = resp.valor; }
          nuevasFilas.push(filaResp);
        });
      }
      sheetResp.getRange(1, 1, sheetResp.getMaxRows(), sheetResp.getMaxColumns()).clearContent();
      sheetResp.getRange(1, 1, nuevasFilas.length, nuevasFilas[0].length).setValues(nuevasFilas);
    } else {
      if (payload.respuestas && payload.respuestas.length > 0) {
        let rowsToInsert = payload.respuestas.map((resp, index) => {
          let filaResp = new Array(headResp.length).fill("");
          if(iIdResp !== -1) filaResp[iIdResp] = "RSP-" + new Date().getTime() + "-" + index;
          if(iIdEvR !== -1) filaResp[iIdEvR] = idEvaluacion;
          if(iIdCrit !== -1) filaResp[iIdCrit] = resp.id_criterio;
          if (resp.es_archivo) { if(iEvi !== -1) filaResp[iEvi] = resp.valor; } 
          else { if(iVal !== -1) filaResp[iVal] = resp.valor; }
          return filaResp;
        });
        sheetResp.getRange(sheetResp.getLastRow() + 1, 1, rowsToInsert.length, headResp.length).setValues(rowsToInsert);
      }
    }

    return { success: true, id_evaluacion: idEvaluacion, es_actualizacion: esActualizacion };
  } catch (error) {
    throw new Error("Fallo al guardar: " + error.message);
  }
}

// 3. OBTIENE LISTA DEL HISTORIAL PARA LA TABLA (Tu función, con el parseo blindado añadido)
function apiObtenerEvaluacionesPorTramite(id_tramite) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetPlantillas = ss.getSheetByName("CFG_PLANTILLAS");
    const sheetEval = ss.getSheetByName("DAT_EVALUACIONES");
    const sheetResp = ss.getSheetByName("DAT_RESPUESTAS"); 
    const sheetCrit = ss.getSheetByName("CFG_CRITERIOS"); 
    
    if (!sheetPlantillas || !sheetEval) return { success: true, evaluaciones: [], columnasDinamicas: [] };

    const dataPlan = sheetPlantillas.getDataRange().getValues();
    let headPlan = dataPlan[0].map(h => String(h).trim().toLowerCase());
    let idxPlanIdPlan = headPlan.indexOf("id_plantilla");
    let idxPlanIdTram = headPlan.indexOf("id_tramite");
    
    let plantillasDelTramite = [];
    let idPlantillaMasReciente = null;
    for (let i = 1; i < dataPlan.length; i++) {
      if (dataPlan[i][idxPlanIdTram] === id_tramite) {
        plantillasDelTramite.push(dataPlan[i][idxPlanIdPlan]);
        idPlantillaMasReciente = dataPlan[i][idxPlanIdPlan];
      }
    }

    // A. OBTENER QUÉ COLUMNAS SE DEBEN MOSTRAR (AHORA CON BLINDAJE)
    let columnasDinamicas = [];
    if (sheetCrit && idPlantillaMasReciente) {
      const dataCrit = sheetCrit.getDataRange().getValues();
      let headCrit = dataCrit[0].map(h => String(h).trim().toLowerCase()); // <-- EL BLINDAJE
      
      let idxCritIdPlan = headCrit.indexOf("id_plantilla");
      let idxCritIdCrit = headCrit.indexOf("id_criterio");
      let idxCritEtiq = headCrit.indexOf("etiqueta_pregunta");
      let idxCritMost = headCrit.indexOf("mostrar_en_tabla");
      
      if(idxCritMost !== -1) {
        for (let i = 1; i < dataCrit.length; i++) {
          if (dataCrit[i][idxCritIdPlan] === idPlantillaMasReciente) {
            // Evaluamos con trim() para evadir espacios ocultos en Google Sheets
            let mostrar = dataCrit[i][idxCritMost] === true || String(dataCrit[i][idxCritMost]).trim().toLowerCase() === 'true';
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

    // B. OBTENER LAS EVALUACIONES (AHORA CON BLINDAJE)
    const dataEval = sheetEval.getDataRange().getValues();
    let headEval = dataEval[0].map(h => String(h).trim().toLowerCase()); // <-- EL BLINDAJE
    
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
          respuestas: {} 
        };
      }
    }

    // C. OBTENER LAS RESPUESTAS ASOCIADAS (AHORA CON BLINDAJE)
    if (sheetResp && columnasDinamicas.length > 0) {
      const dataResp = sheetResp.getDataRange().getValues();
      let headResp = dataResp[0].map(h => String(h).trim().toLowerCase()); // <-- EL BLINDAJE
      
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
    
    return { success: true, evaluaciones: evaluaciones, columnasDinamicas: columnasDinamicas };
  } catch (error) {
    return { success: false, evaluaciones: [], columnasDinamicas: [] };
  }
}

