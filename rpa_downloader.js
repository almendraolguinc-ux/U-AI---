require('dotenv').config();
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { obtenerClienteDrive, obtenerOCrearCarpeta, subirArchivoADrive, descargarArchivoDeDrive } = require('./google_drive_helper');

// Cargar reglas de corte
let reglasCorte = [];
try {
  reglasCorte = require('./reglas_corte.json');
  console.log('✅ Reglas de corte cargadas con éxito.');
} catch (error) {
  console.error('❌ Error al cargar reglas_corte.json:', error.message);
  process.exit(1);
}

// Configurar transportador de correos SMTP
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.office365.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // true para puerto 465, false para otros
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

/**
 * Función para enviar correos electrónicos
 */
async function enviarEmail(to, subject, htmlBody) {
  // MODO PRUEBA: NUNCA enviar correos reales
  console.log(`✉️ [MODO PRUEBA - CORREO SIMULADO] Se habría enviado correo a: ${to} (Asunto: "${subject}")`);
  return true; // Retornar true para continuar el flujo normalmente en la simulación
}

/**
 * Normaliza textos para comparación flexible
 */
function normalizarTexto(texto) {
  if (!texto) return '';
  return texto.toString().toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remueve tildes
    .trim();
}

/**
 * Flujo Principal del RPA
 */
async function ejecutarRPA() {
  console.log('🤖 Iniciando RPA de Admisión UAI...');

  // Inicializar Google Drive
  let driveClient = null;
  let carpetaRaizDriveId = null;
  try {
    driveClient = obtenerClienteDrive();
    console.log('🤖 Conexión establecida con la API de Google Drive.');
    if (process.env.DRIVE_FOLDER_ID) {
      carpetaRaizDriveId = process.env.DRIVE_FOLDER_ID;
      console.log(`🤖 Carpeta raíz de Google Drive configurada por ID: ${carpetaRaizDriveId}`);
    } else {
      carpetaRaizDriveId = await obtenerOCrearCarpeta(driveClient, 'Postulaciones UAI RPA');
    }
  } catch (errDrive) {
    console.error('❌ No se pudo conectar a Google Drive. Se continuará solo de forma local:', errDrive.message);
  }
  
  // 1. Iniciar Navegador
  const headless = process.env.HEADLESS === 'true';
  console.log(`🌐 Abriendo navegador Chromium (Modo Headless: ${headless})...`);
  
  const browser = await chromium.launch({
    headless: headless,
    downloadsPath: path.resolve(__dirname, 'temp_downloads')
  });
  
  const context = await browser.newContext({
    acceptDownloads: true
  });
  
  const page = await context.newPage();
  
  // 2. Navegar a la página de Postulantes con reintentos por estabilidad de red
  console.log('🔗 Navegando a la página de postulación...');
  let reintentos = 3;
  while (reintentos > 0) {
    try {
      await page.goto('https://admisionpregrado.uai.cl/AdminAdmision/AdmisionEspecial/Postulantes', { timeout: 60000 });
      break;
    } catch (e) {
      reintentos--;
      console.log(`⚠️ Error de conexión (${e.message}). Reintentando en 3 segundos... (Reintentos restantes: ${reintentos})`);
      if (reintentos === 0) throw e;
      await page.waitForTimeout(3000);
    }
  }
  
  // Lógica de Login:
  // Si las credenciales en .env son las por defecto, pausar para que el usuario inicie sesión manualmente
  const userEnv = process.env.UAI_USER;
  const passEnv = process.env.UAI_PASSWORD;
  
  if (!userEnv || userEnv.includes('INGRESA_AQUI') || !passEnv || passEnv.includes('INGRESA_AQUI')) {
    console.log('\n🛑 ATENCIÓN: No se han configurado credenciales reales en el archivo .env.');
    console.log('👉 Por favor, inicia sesión manualmente en la ventana del navegador que se ha abierto.');
    console.log('👉 Una vez que hayas iniciado sesión y estés dentro de la sección "Postulantes", presiona ENTER en esta terminal para continuar...');
    
    // Esperar Enter en la consola
    await new Promise(resolve => process.stdin.once('data', resolve));
  } else {
    console.log('🔐 Automatizando inicio de sesión de Microsoft Office 365...');
    try {
      // Paso 1: Ingresar correo institucional de Microsoft
      console.log('   - Esperando campo de correo...');
      await page.waitForSelector('#i0116', { timeout: 15000 });
      await page.fill('#i0116', userEnv);
      console.log('   - Correo ingresado. Presionando Siguiente...');
      await page.click('#idSIButton9');

      // Paso 2: Ingresar contraseña
      console.log('   - Esperando campo de contraseña...');
      await page.waitForSelector('#i0118', { state: 'visible', timeout: 15000 });
      // Espera corta por la transición animada de Microsoft
      await page.waitForTimeout(1500); 
      await page.fill('#i0118', passEnv);
      console.log('   - Contraseña ingresada. Iniciando sesión...');
      await page.click('#idSIButton9');

      // Paso 3: Pregunta de "¿Mantener la sesión iniciada?"
      console.log('   - Verificando pantalla de mantener sesión iniciada...');
      try {
        await page.waitForSelector('#idSIButton9', { state: 'visible', timeout: 5000 });
        await page.click('#idSIButton9'); // Hacer clic en "Sí"
        console.log('   - Sesión confirmada.');
      } catch (errKeep) {
        console.log('   - Pantalla de mantener sesión no requerida o saltada.');
      }

      console.log('⏳ Esperando redirección al portal de Admisión UAI...');
      await page.waitForURL('**/Postulantes**', { timeout: 45000 });
      console.log('✅ Redirección exitosa. Sesión iniciada.');
    } catch (loginError) {
      console.error('❌ Error durante el inicio de sesión automático:', loginError.message);
      console.log('👉 Por favor, inicia sesión manualmente en la ventana del navegador.');
      console.log('👉 Una vez dentro de la sección "Postulantes", presiona ENTER en esta terminal para continuar...');
      await new Promise(resolve => process.stdin.once('data', resolve));
    }
  }

  // Asegurarnos de que estamos en la página de postulantes
  await page.goto('https://admisionpregrado.uai.cl/AdminAdmision/AdmisionEspecial/Postulantes');
  await page.waitForLoadState('networkidle');

  // 3. Subproceso 1: Filtrado y Exportación Web
  console.log('🔍 Aplicando filtro de Vía de Postulación...');
  try {
    // Buscamos el filtro/dropdown de Vía de Postulación. 
    // Dado que no conocemos el selector exacto, buscamos selectores o botones que contengan texto relevante.
    // Intentaremos buscar un selector <select> o botones que puedan desplegar el filtro.
    
    // Buscar dropdown o selector de vía de postulación
    const selectoresVia = [
      'select[name*="via"]', 
      'select[name*="Via"]', 
      'select[name*="Postulacion"]',
      '#ViaPostulacionId',
      '#IdViaPostulacion'
    ];
    
    let selectEncontrado = false;
    for (const selector of selectoresVia) {
      if (await page.$(selector)) {
        console.log(`   Encontrado selector de vía: ${selector}`);
        // Intentar seleccionar la opción que contenga el texto
        const options = await page.$$eval(`${selector} option`, opts => 
          opts.map(o => ({ text: o.textContent, value: o.value }))
        );
        const opcionDeseada = options.find(o => 
          o.text.toUpperCase().includes('DESEMPEÑO DESTACADO') || 
          o.text.toUpperCase().includes('DESEMPENO DESTACADO')
        );
        if (opcionDeseada) {
          await page.selectOption(selector, opcionDeseada.value);
          selectEncontrado = true;
          console.log(`   Seleccionada opción: "${opcionDeseada.text}" (Valor: ${opcionDeseada.value})`);
          break;
        }
      }
    }

    if (!selectEncontrado) {
      console.log('⚠️ Selector HTML de Vía de Postulación no detectado automáticamente.');
      console.log('👉 Por favor, selecciona manualmente la vía "DESEMPEÑO DESTACADO EN LA ENSEÑANZA MEDIA" en la página web.');
      console.log('👉 Una vez seleccionado el filtro y presionado "Filtrar/Buscar", presiona ENTER aquí para continuar...');
      await new Promise(resolve => process.stdin.once('data', resolve));
    } else {
      // Hacer clic en el botón de filtrar/buscar si existe
      const btnFiltrar = await page.$('button:has-text("Filtrar"), input[value="Filtrar"], button:has-text("Buscar"), #btnFiltrar');
      if (btnFiltrar) {
        await btnFiltrar.click();
        await page.waitForLoadState('networkidle');
        console.log('   Filtro aplicado en la web.');
      }
    }

    // 4. Exportar a Excel y Descargar
    console.log('📥 Intentando hacer clic en "Exportar excel" o "Exportar"...');
    // Esperar y capturar el evento de descarga
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60000 }), 
      page.click('button:has-text("Exportar"), a:has-text("Exportar"), button:has-text("Excel"), .btn-exportar, #btnExportar')
    ]);

    const downloadPath = path.resolve(__dirname, 'postulantes_descargado.xlsx');
    await download.saveAs(downloadPath);
    console.log(`📊 Archivo Excel descargado y guardado en: ${downloadPath}`);

    // Intentar descargar el Excel consolidado previo de Drive para sincronización inteligente
    let pathExcelPrevio = null;
    if (driveClient && carpetaRaizDriveId) {
      try {
        const localPrevioPath = path.join(__dirname, 'resultado_proceso_rpa_previo.xlsx');
        const carpetaDbDriveId = await obtenerOCrearCarpeta(driveClient, 'Base de Datos', carpetaRaizDriveId);
        const descargado = await descargarArchivoDeDrive(
          driveClient, 
          process.env.REPORTE_FINAL || 'resultado_proceso_rpa.xlsx', 
          carpetaDbDriveId, 
          localPrevioPath
        );
        if (descargado) {
          pathExcelPrevio = localPrevioPath;
          console.log('🤖 Histórico de Drive descargado exitosamente para la sincronización inteligente.');
        }
      } catch (errPrevio) {
        console.warn('⚠️ No se pudo descargar el Excel previo de Drive para sincronizar:', errPrevio.message);
      }
    }

    // 5. Procesar el Excel Descargado
    await procesarExcelUAI(downloadPath, page, driveClient, carpetaRaizDriveId, pathExcelPrevio);

  } catch (err) {
    console.error('❌ Error en el Subproceso 1:', err.message);
    console.log('👉 Si falló la descarga automática, por favor descarga el Excel manualmente, guárdalo como "postulantes_descargado.xlsx" en esta carpeta, y presiona ENTER para procesarlo...');
    await new Promise(resolve => process.stdin.once('data', resolve));
    const downloadPath = path.resolve(__dirname, 'postulantes_descargado.xlsx');
    if (fs.existsSync(downloadPath)) {
      // Re-intentar también la descarga previa en el fallback manual
      let pathExcelPrevio = null;
      if (driveClient && carpetaRaizDriveId) {
        try {
          const localPrevioPath = path.join(__dirname, 'resultado_proceso_rpa_previo.xlsx');
          const carpetaDbDriveId = await obtenerOCrearCarpeta(driveClient, 'Base de Datos', carpetaRaizDriveId);
          const descargado = await descargarArchivoDeDrive(
            driveClient, 
            process.env.REPORTE_FINAL || 'resultado_proceso_rpa.xlsx', 
            carpetaDbDriveId, 
            localPrevioPath
          );
          if (descargado) pathExcelPrevio = localPrevioPath;
        } catch (e) {}
      }
      await procesarExcelUAI(downloadPath, page, driveClient, carpetaRaizDriveId, pathExcelPrevio);
    } else {
      console.error('❌ No se encontró el archivo "postulantes_descargado.xlsx". Abortando proceso.');
    }
  }

  // Cerrar navegador
  console.log('🔌 Cerrando navegador...');
  await browser.close();
  console.log('🤖 Proceso RPA finalizado.');
}

/**
 * Mapeo inteligente (fuzzy matching) para carreras de la UAI
 */
function mapearCarrera(carreraExcel) {
  if (!carreraExcel) return null;
  const normal = normalizarTexto(carreraExcel);
  
  // Identificar la sede con absoluta seguridad
  const esVina = normal.includes('vina') || normal.includes('vdm') || normal.includes('mar');
  const esStgo = normal.includes('stgo') || normal.includes('santiago') || normal.includes('penalolen') || normal.includes('peñalolen');
  
  // Si no se puede determinar la sede, es ambiguo
  if (!esVina && !esStgo) return null;

  // 12. Doble Título Comercial y Sociología (Solo Stgo)
  if (normal.includes('doble') || (normal.includes('comercial') && normal.includes('sociologia'))) {
    if (esStgo) return "DOBLE TÍTULO COMERCIAL Y SOCIOLOGÍA/ STGO - PEÑALOLÉN 2026";
    return null;
  }

  // 5 y 11. Licenciatura en Comunicación Social / Periodismo
  if (normal.includes('comunicacion') || normal.includes('periodismo') || normal.includes('social') || normal.includes('periodista')) {
    if (esVina) return "LICENCIATURA EN COMUNICACIÓN SOCIAL - PLAN COMÚN / VIÑA - VIÑA DEL MAR 2026";
    if (esStgo) return "LICENCIATURA EN COMUNICACIÓN SOCIAL - PLAN COMÚN / STGO - PEÑALOLEN 2026";
  }

  // 4 y 10. Psicología
  if (normal.includes('psicologia') || normal.includes('psico')) {
    if (esVina) return "PSICOLOGÍA/ VIÑA - VIÑA DEL MAR 2026";
    if (esStgo) return "PSICOLOGÍA / STGO - PEÑALOLÉN 2026";
  }

  // 3 y 9. Derecho
  if (normal.includes('derecho')) {
    if (esVina) return "DERECHO /VIÑA - VIÑA DEL MAR 2026";
    if (esStgo) return "DERECHO / STGO - PEÑALOLÉN 2026";
  }

  // 8. Ingeniería Civil Industrial (Solo Viña del Mar en la lista)
  if (normal.includes('industrial') && (normal.includes('civil') || esVina)) {
    if (esVina) return "INGENIERÍA CIVIL INDUSTRIAL / VIÑA - VIÑA DEL MAR 2026";
    return null; // Si es Santiago, no está en la lista de reglas
  }

  // 1 y 6. Ingeniería Comercial
  if (normal.includes('comercial')) {
    if (esVina) return "INGENIERÍA COMERCIAL LCS/ VIÑA - VIÑA DEL MAR 2026";
    if (esStgo) return "INGENIERÍA COMERCIAL - PLAN COMÚN / STGO - PEÑALOLEN 2026";
  }

  // 2 y 7. Ingeniería Civil (Plan Común)
  if (normal.includes('civil')) {
    if (esVina) return "INGENIERÍA CIVIL - PLAN COMÚN / VIÑA - VIÑA DEL MAR 2026";
    if (esStgo) return "INGENIERÍA CIVIL - PLAN COMÚN / STGO - PEÑALOLÉN 2026";
  }

  return null;
}

/**
 * Procesa el Excel de la UAI, aplica las reglas y realiza las descargas del Subproceso 2
 */
async function procesarExcelUAI(excelPath, page, driveClient, carpetaRaizDriveId, pathExcelPrevio = null) {
  console.log('📖 Leyendo y analizando archivo Excel...');
  const workbook = XLSX.readFile(excelPath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet);

  if (rows.length === 0) {
    console.warn('⚠️ El archivo Excel está vacío o no contiene filas.');
    return;
  }

  // Cargar el histórico consolidado si existe para sincronización inteligente
  const mapaHistorico = {};
  if (pathExcelPrevio && fs.existsSync(pathExcelPrevio)) {
    try {
      console.log('🤖 Cargando histórico de Drive para sincronización inteligente...');
      const workbookPrevio = XLSX.readFile(pathExcelPrevio);
      const sheetNamePrevio = workbookPrevio.SheetNames[0];
      const rowsPrevio = XLSX.utils.sheet_to_json(workbookPrevio.Sheets[sheetNamePrevio]);
      
      if (rowsPrevio.length > 0) {
        const colKeysPrevio = Object.keys(rowsPrevio[0]);
        const colIdPrevio = colKeysPrevio.find(k => k.toLowerCase() === 'id' || k.toLowerCase() === 'postulanteid' || k.toLowerCase().includes('admisionpostulanteid')) || colKeysPrevio[0];
        
        for (const filaPrevio of rowsPrevio) {
          const idPrevio = filaPrevio[colIdPrevio];
          if (idPrevio) {
            mapaHistorico[idPrevio.toString().trim()] = filaPrevio;
          }
        }
        console.log(`🤖 Histórico cargado con éxito. Se encontraron ${Object.keys(mapaHistorico).length} registros previos.`);
      }
    } catch (errParsePrevio) {
      console.error('⚠️ Error al leer el Excel previo descargado de Drive:', errParsePrevio.message);
    }
  }

  // Detectar columnas del Excel de forma flexible
  const firstRow = rows[0];
  const colKeys = Object.keys(firstRow);
  
  // Buscar mapeo de columnas según nombres configurados o similitudes
  const colEmail = colKeys.find(k => normalizarTexto(k) === normalizarTexto(process.env.COL_EMAIL || 'MAIL')) || colKeys.find(k => k.toLowerCase().includes('mail') || k.toLowerCase().includes('correo'));
  const colPreferencia = colKeys.find(k => normalizarTexto(k) === normalizarTexto(process.env.COL_PREFERENCIA || 'PrimeraPreferencia')) || colKeys.find(k => k.toLowerCase().includes('preferencia') || k.toLowerCase().includes('carrera'));
  const colPuntaje = colKeys.find(k => normalizarTexto(k) === normalizarTexto(process.env.COL_PUNTAJE_PAES || 'MaximoPuntajePAESPrimeraPreferencia')) || colKeys.find(k => k.toLowerCase().includes('paes') || k.toLowerCase().includes('puntaje'));
  const colNem = colKeys.find(k => normalizarTexto(k) === normalizarTexto(process.env.COL_NEM || 'PromedioNotasEnseñanzaMedia')) || colKeys.find(k => k.toLowerCase().includes('nem') || k.toLowerCase().includes('promedio') || k.toLowerCase().includes('notas'));
  const colDocsEnviados = colKeys.find(k => normalizarTexto(k) === normalizarTexto(process.env.COL_DOCS_ENVIADOS || 'DocumentosRequeridosAdjuntos')) || colKeys.find(k => k.toLowerCase().includes('adjuntos') || k.toLowerCase().includes('documentos') || k.toLowerCase().includes('requeridos'));
  const colEgreso = colKeys.find(k => k.toLowerCase().includes('egreso') || k.toLowerCase().includes('anoegreso') || k.toLowerCase().includes('añoegreso')) || 'AñoEgreso';
  
  // ID del alumno
  const colId = colKeys.find(k => k.toLowerCase() === 'id' || k.toLowerCase() === 'postulanteid' || k.toLowerCase().includes('admisionpostulanteid')) || colKeys[0];

  console.log('📌 Columnas identificadas:');
  console.log(`   - ID Postulante: [${colId}]`);
  console.log(`   - Email: [${colEmail}]`);
  console.log(`   - Carrera / Preferencia: [${colPreferencia}]`);
  console.log(`   - Puntaje PAES: [${colPuntaje}]`);
  console.log(`   - Promedio NEM: [${colNem}]`);
  console.log(`   - Docs Enviados (Columna Q): [${colDocsEnviados}]`);
  console.log(`   - Año de Egreso: [${colEgreso}]`);

  const registrosProcesados = [];
  const aprobadosSubproceso2 = [];

  // Crear directorio de descargas si no existe
  const downloadDir = path.resolve(__dirname, process.env.DOWNLOAD_DIR || 'descargas_postulantes');
  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  // Subproceso 1: Aplicar Filtros y Criterios
  console.log(`\n📋 Procesando ${rows.length} postulantes de la vía de Desempeño Destacado...`);
  
  for (let index = 0; index < rows.length; index++) {
    const fila = rows[index];
    const id = fila[colId];
    const email = fila[colEmail];
    const carrera = fila[colPreferencia];
    const puntajeRaw = fila[colPuntaje];
    const nemRaw = fila[colNem];
    const docsAdjuntosRaw = fila[colDocsEnviados] || '';
    const anoRaw = fila[colEgreso];

    const normalId = id ? id.toString().trim() : `Fila_${index + 2}`;
    console.log(`\n👤 Postulante ID: ${normalId} (${carrera || 'Sin Carrera'})`);

    // 1. Sincronización Inteligente: Verificar existencia en el histórico previo de Drive
    if (mapaHistorico[normalId]) {
      const registroPrevio = mapaHistorico[normalId];
      const teniaDocsVacios = registroPrevio.RPA_Estado === 'Pendiente de Documentos';
      const tieneDocsAhora = docsAdjuntosRaw && docsAdjuntosRaw.toString().trim() !== '';

      if (teniaDocsVacios && tieneDocsAhora) {
        console.log(`   🔄 [RE-EVALUACIÓN] Postulante ID: ${normalId} subió documentos (Columna Q llena). Re-evaluando notas...`);
        // Continuamos con el flujo para re-evaluarlo y descargarlo
      } else {
        console.log(`   ⚖️ [HISTÓRICO] Postulante ID: ${normalId} ya existe en el histórico (Estado: "${registroPrevio.RPA_Estado}"). Manteniendo registro.`);
        registrosProcesados.push(registroPrevio);
        
        // Si estaba aprobado, lo agregamos a descargas para asegurar consistencia local
        if (registroPrevio.RPA_Estado === 'Aprobado para Descarga') {
          aprobadosSubproceso2.push({
            id: normalId,
            carrera: carrera,
            email: email,
            filaIndex: registrosProcesados.length - 1,
            datosOriginales: fila
          });
        }
        continue; // Omitir el resto de validaciones para este postulante
      }
    }

    // 2. Filtrado por Año de Egreso (Solo 2024 o 2025)
    const ano = anoRaw ? parseInt(anoRaw.toString().trim()) : null;
    if (ano && ano !== 2024 && ano !== 2025) {
      console.log(`   ❌ Omitido por Año de Egreso (${ano}). Solo se procesan egresados 2024/2025.`);
      continue; // Omitir completamente del reporte final
    }

    // 2. Validación de Consistencia (NEM o Puntaje en Cero/Vacío)
    const puntajeEsVacio = puntajeRaw === undefined || puntajeRaw === null || puntajeRaw === '' || parseFloat(puntajeRaw) === 0;
    const nemEsVacio = nemRaw === undefined || nemRaw === null || nemRaw === '' || parseFloat(nemRaw) === 0;
    
    if (puntajeEsVacio || nemEsVacio) {
      console.log(`   ⚠️ Derivado a Revisión Manual: NEM o Puntaje vacío/cero.`);
      registrosProcesados.push({
        ...fila,
        RPA_Estado: 'Revisión Manual',
        RPA_Motivo: 'NEM o Puntaje PAES vacío o en cero'
      });
      continue;
    }

    const puntaje = parseFloat(puntajeRaw);
    const nem = parseFloat(nemRaw);

    // 3. Validación Preliminar de Documentos (Columna Q)
    if (!docsAdjuntosRaw || docsAdjuntosRaw.toString().trim() === '') {
      console.log(`   ❌ Columna Q vacía. No ha enviado documentos.`);
      const subject = 'UAI Admisión Especial - Por favor sube tus documentos';
      const body = `
        <p>Estimado/a postulante,</p>
        <p>Hemos detectado que en tu postulación a la vía de <strong>Desempeño Destacado en la Enseñanza Media</strong> aún no has subido tus documentos adjuntos requeridos.</p>
        <p>Por favor, ingresa a la plataforma y sube la documentación a la brevedad para poder procesar tu postulación.</p>
        <p>Atentamente,<br>Admisión UAI</p>
      `;
      const emailEnviado = await enviarEmail(email, subject, body);
      
      registrosProcesados.push({
        ...fila,
        RPA_Estado: 'Pendiente de Documentos',
        RPA_Motivo: 'Columna Q vacía'
      });
      continue;
    }

    // 4. Validación de Criterios (NEM y Puntaje Ponderado)
    // Mapear la carrera de forma inteligente (fuzzy matching)
    const carreraMapeada = mapearCarrera(carrera);
    const regla = reglasCorte.find(r => normalizarTexto(r.carrera) === normalizarTexto(carreraMapeada));
    
    if (!regla) {
      console.warn(`   ⚠️ La carrera "${carrera}" no se pudo asociar a ninguna regla de corte. Mapeada como: "${carreraMapeada}".`);
      registrosProcesados.push({
        ...fila,
        RPA_Estado: 'Revisión Manual',
        RPA_Motivo: 'Carrera no identificada'
      });
      continue;
    }

    const cumplePuntaje = puntaje >= regla.puntaje_minimo;
    const cumpleNem = nem > regla.nem_minimo; // PromedioNotasEnseñanzaMedia > NEM_MINIMO

    if (cumplePuntaje && cumpleNem) {
      console.log(`   ✅ CUMPLE CRITERIOS. (NEM: ${nem} > ${regla.nem_minimo} y Puntaje: ${puntaje} >= ${regla.puntaje_minimo})`);
      aprobadosSubproceso2.push({
        id: normalId,
        carrera: carrera,
        email: email,
        filaIndex: registrosProcesados.length,
        datosOriginales: fila
      });
      
      registrosProcesados.push({
        ...fila,
        RPA_Estado: 'Aprobado para Descarga',
        RPA_Motivo: `Cumple NEM (> ${regla.nem_minimo}) y Puntaje (>= ${regla.puntaje_minimo})`
      });
    } else {
      let motivoDescarte = '';
      if (!cumplePuntaje && !cumpleNem) motivoDescarte = `No cumple NEM (> ${regla.nem_minimo}) ni Puntaje (>= ${regla.puntaje_minimo})`;
      else if (!cumplePuntaje) motivoDescarte = `No cumple Puntaje (Puntaje: ${puntaje} < Mínimo: ${regla.puntaje_minimo})`;
      else motivoDescarte = `No cumple NEM (NEM: ${nem} <= Mínimo: ${regla.nem_minimo})`;
      
      console.log(`   ❌ DESCARTADO. Motivo: ${motivoDescarte}`);
      
      const subject = 'UAI Admisión Especial - Resultado de Postulación';
      const body = `
        <p>Estimado/a postulante,</p>
        <p>Agradecemos tu interés en postular a la Universidad Adolfo Ibáñez por la vía de <strong>Desempeño Destacado en la Enseñanza Media</strong> para la carrera de ${carrera}.</p>
        <p>Lamentamos informarte que en esta oportunidad tu postulación no cumple con los criterios de puntaje o NEM mínimos exigidos para esta vía.</p>
        <p>Te deseamos el mayor de los éxitos en tus futuros procesos.</p>
        <p>Atentamente,<br>Admisión UAI</p>
      `;
      const emailEnviado = await enviarEmail(email, subject, body);

      registrosProcesados.push({
        ...fila,
        RPA_Estado: 'Descartado por Criterio',
        RPA_Motivo: motivoDescarte
      });
    }
  }

  // Subproceso 2: Descargar Documentos de Fichas de Aprobados
  console.log(`\n📂 Iniciando Subproceso 2: Descarga de fichas para ${aprobadosSubproceso2.length} postulantes aprobados...`);
  
  // Crear carpeta 'Aceptados' localmente
  const aceptadosFolder = path.join(downloadDir, 'Aceptados');
  if (!fs.existsSync(aceptadosFolder)) {
    fs.mkdirSync(aceptadosFolder, { recursive: true });
  }

  // Crear o buscar la carpeta 'Aceptados' en Google Drive
  let carpetaAceptadosDriveId = carpetaRaizDriveId;
  if (driveClient && carpetaRaizDriveId) {
    try {
      carpetaAceptadosDriveId = await obtenerOCrearCarpeta(driveClient, 'Aceptados', carpetaRaizDriveId);
      console.log(`📂 Carpeta 'Aceptados' configurada en Google Drive (ID: ${carpetaAceptadosDriveId})`);
    } catch (errDriveAceptados) {
      console.error(`⚠️ No se pudo crear la carpeta 'Aceptados' en Drive:`, errDriveAceptados.message);
    }
  }

  for (const aprobado of aprobadosSubproceso2) {
    const studentId = aprobado.id;
    console.log(`\n📥 Procesando Ficha Alumno para ID: ${studentId}`);

    // Carpeta local del alumno dentro de Aceptados
    const studentFolder = path.join(aceptadosFolder, studentId);
    if (!fs.existsSync(studentFolder)) {
      fs.mkdirSync(studentFolder, { recursive: true });
    }

    // Lógica incremental / idempotente: Comprobar si ya existen localmente los documentos en la subcarpeta del alumno
    let yaDescargado = false;
    let localConcentracion = null;
    let localLicencia = null;

    if (fs.existsSync(studentFolder)) {
      const archivosLocales = fs.readdirSync(studentFolder);
      localConcentracion = archivosLocales.find(f => f.startsWith('Concentracion_Notas'));
      localLicencia = archivosLocales.find(f => f.startsWith('Licencia_Ensenanza_Media'));
      if (localConcentracion && localLicencia) {
        yaDescargado = true;
      }
    }

    if (yaDescargado) {
      console.log(`   ⏭️ [OMITIDO] Postulante ID ${studentId} ya fue descargado previamente.`);
      const filaIndex = aprobado.filaIndex;
      registrosProcesados[filaIndex] = {
        ...registrosProcesados[filaIndex],
        RPA_Concentracion_Descargada: 'Sí (Previa)',
        RPA_Licencia_Descargada: 'Sí (Previa)',
        RPA_Identidad_Pasaporte_Existe: 'Sí (Previa)',
        RPA_Documentos_Descargados_Cant: 2,
        RPA_Subido_Drive_Concentracion: 'Sí (Previa)',
        RPA_Subido_Drive_Licencia: 'Sí (Previa)'
      };
      continue; // Saltar navegación a la ficha
    }

    // Crear subcarpeta para este alumno en Google Drive (dentro de la carpeta 'Aceptados')
    let subcarpetaAlumnoId = null;
    if (driveClient && carpetaAceptadosDriveId) {
      try {
        subcarpetaAlumnoId = await obtenerOCrearCarpeta(driveClient, studentId, carpetaAceptadosDriveId);
      } catch (errSub) {
        console.error(`   ⚠️ No se pudo crear la carpeta del alumno ${studentId} en Drive:`, errSub.message);
      }
    }

    try {
      // Modificar link por la ficha del alumno
      const urlFicha = `https://admisionpregrado.uai.cl/AdminAdmision/AdmisionEspecial/FichaAlumno?AdmisionPostulanteId=${studentId}`;
      console.log(`   Navegando a: ${urlFicha}`);
      await page.goto(urlFicha, { timeout: 45000 });
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      // Hacer clic en la pestaña "Documentos Adjuntos"
      console.log('   🖱️ Seleccionando pestaña "Documentos Adjuntos"...');
      await page.locator('a').filter({ hasText: 'Documentos Adjuntos' }).first().click();
      await page.waitForTimeout(3000);

      // Localizar la tabla de documentos
      const tabla = page.locator('table:has-text("Nombre Documentos")');
      const filas = tabla.locator('tbody tr');
      const totalFilas = await filas.count();
      
      let concentracionDescargada = 'No';
      let licenciaDescargada = 'No';
      let existeIdentidadOPasaporte = 'No';
      let descargadosCount = 0;
      let subidoADriveConcentracion = 'No';
      let subidoADriveLicencia = 'No';

      console.log(`   📊 Analizando tabla de documentos adjuntos... (${totalFilas} filas encontradas)`);

      for (let i = 0; i < totalFilas; i++) {
        const fila = filas.nth(i);
        const celdas = fila.locator('td');
        const totalCeldas = await celdas.count();
        
        if (totalCeldas < 5) continue; // Fila vacía o sin acciones

        const nombreDocRaw = await celdas.nth(0).innerText();
        const nombreDoc = nombreDocRaw.trim();
        const normalNombre = normalizarTexto(nombreDoc);

        // 1. Concentración de notas:
        if (normalNombre.includes('concentracion') && normalNombre.includes('notas')) {
          console.log(`      -> Descargando Concentración de Notas: "${nombreDoc}"`);
          const downloadBtn = celdas.nth(4).locator('a, i.fa-download').first();
          const finalName = await descargarArchivo(page, downloadBtn, studentFolder, 'Concentracion_Notas');
          if (finalName) {
            concentracionDescargada = 'Sí';
            descargadosCount++;
            
            // Subir a Google Drive
            if (driveClient && subcarpetaAlumnoId) {
              try {
                const localPath = path.join(studentFolder, finalName);
                await subirArchivoADrive(driveClient, finalName, localPath, subcarpetaAlumnoId);
                subidoADriveConcentracion = 'Sí';
              } catch (errDriveUpload) {
                console.error(`         ❌ Error al subir Concentración a Drive:`, errDriveUpload.message);
              }
            }
          }
        }
        
        // 2. Licencia de Enseñanza Media:
        else if (normalNombre.includes('licencia') && (normalNombre.includes('ensenanza') || normalNombre.includes('media'))) {
          console.log(`      -> Descargando Licencia de Enseñanza Media: "${nombreDoc}"`);
          const downloadBtn = celdas.nth(4).locator('a, i.fa-download').first();
          const finalName = await descargarArchivo(page, downloadBtn, studentFolder, 'Licencia_Ensenanza_Media');
          if (finalName) {
            licenciaDescargada = 'Sí';
            descargadosCount++;
 
            // Subir a Google Drive
            if (driveClient && subcarpetaAlumnoId) {
              try {
                const localPath = path.join(studentFolder, finalName);
                await subirArchivoADrive(driveClient, finalName, localPath, subcarpetaAlumnoId);
                subidoADriveLicencia = 'Sí';
              } catch (errDriveUpload) {
                console.error(`         ❌ Error al subir Licencia a Drive:`, errDriveUpload.message);
              }
            }
          }
        }
        
        // 3. Cédula de Identidad o Pasaporte (Validación de existencia sin descargar):
        else if ((normalNombre.includes('cedula') || normalNombre.includes('identidad') || normalNombre.includes('pasaporte'))) {
          const downloadBtn = celdas.nth(4).locator('a, i.fa-download').first();
          const existeBoton = await downloadBtn.count() > 0;
          if (existeBoton) {
            console.log(`      -> Detectado documento de Identidad/Pasaporte: "${nombreDoc}"`);
            existeIdentidadOPasaporte = 'Sí';
          }
        }
      }

      console.log(`   Resultados Ficha: Concentración: ${concentracionDescargada} | Licencia: ${licenciaDescargada} | Identidad/Pasaporte: ${existeIdentidadOPasaporte}`);

      // Actualizar registro en la lista final
      const filaIndex = aprobado.filaIndex;
      registrosProcesados[filaIndex] = {
        ...registrosProcesados[filaIndex],
        RPA_Concentracion_Descargada: concentracionDescargada,
        RPA_Licencia_Descargada: licenciaDescargada,
        RPA_Identidad_Pasaporte_Existe: existeIdentidadOPasaporte,
        RPA_Documentos_Descargados_Cant: descargadosCount,
        RPA_Subido_Drive_Concentracion: subidoADriveConcentracion,
        RPA_Subido_Drive_Licencia: subidoADriveLicencia
      };

    } catch (errFicha) {
      console.error(`   ❌ Error al procesar la ficha del ID ${studentId}:`, errFicha.message);
      const filaIndex = aprobado.filaIndex;
      registrosProcesados[filaIndex] = {
        ...registrosProcesados[filaIndex],
        RPA_Estado: 'Fallo Subproceso 2',
        RPA_Motivo: `Error al abrir ficha o descargar: ${errFicha.message}`
      };
    }
  }

  // 6. Generar Reporte Final consolidado
  const dbLocalFolder = path.join(downloadDir, 'Base de Datos');
  if (!fs.existsSync(dbLocalFolder)) {
    fs.mkdirSync(dbLocalFolder, { recursive: true });
  }

  const reportePath = path.join(dbLocalFolder, process.env.REPORTE_FINAL || 'resultado_proceso_rpa.xlsx');
  console.log(`\n💾 Escribiendo reporte consolidado final en: ${reportePath}`);
  
  const newWorkbook = XLSX.utils.book_new();
  const newWorksheet = XLSX.utils.json_to_sheet(registrosProcesados);
  XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'Resultado RPA');
  XLSX.writeFile(newWorkbook, reportePath);
  console.log('🏆 Reporte Excel generado con éxito localmente en Base de Datos.');

  // Subir reporte a Google Drive
  if (driveClient && carpetaRaizDriveId) {
    try {
      // Obtener o crear carpeta 'Base de Datos' en Drive
      const carpetaDbDriveId = await obtenerOCrearCarpeta(driveClient, 'Base de Datos', carpetaRaizDriveId);
      const nombreReporteDrive = process.env.REPORTE_FINAL || 'resultado_proceso_rpa.xlsx';
      
      await subirArchivoADrive(
        driveClient, 
        nombreReporteDrive, 
        reportePath, 
        carpetaDbDriveId, 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      console.log('🏆 Reporte Excel subido a Google Drive (carpeta Base de Datos) con éxito.');
    } catch (errDriveExcel) {
      console.error('❌ Error al subir el reporte Excel a Google Drive:', errDriveExcel.message);
    }
  }

  // Eliminar archivo previo temporal si existe para mantener limpia la carpeta local
  const localPrevioPath = path.join(__dirname, 'resultado_proceso_rpa_previo.xlsx');
  if (fs.existsSync(localPrevioPath)) {
    try {
      fs.unlinkSync(localPrevioPath);
      console.log('🧹 Limpieza del archivo temporal consolidado previo completada.');
    } catch (errUnlink) {
      // Omitir error de borrado
    }
  }
}

/**
 * Función para manejar la descarga de archivos mediante Playwright
 */
async function descargarArchivo(page, elementHandle, targetDir, namePrefix) {
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      elementHandle.click()
    ]);
    
    const originalName = download.suggestedFilename();
    const ext = path.extname(originalName) || '.pdf';
    const finalName = `${namePrefix}${ext}`;
    const finalPath = path.join(targetDir, finalName);
    
    await download.saveAs(finalPath);
    console.log(`         Archivo guardado como: ${finalName}`);
    return finalName;
  } catch (err) {
    console.error(`         ⚠️ Falló la descarga:`, err.message);
    return null;
  }
}

// Ejecutar el script
ejecutarRPA();
