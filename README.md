# Proyecto Final · Automatización e IA para MVP's · MBAn UAI 2026-1S

> **U&AI**

---

## 1 · Identificación

| Campo | Valor |
|---|---|
| Nombre del grupo | **U&AI** |
| Integrantes | Abrahan Aldenzon, Pedro Bustos, María Emilia Calvache, Almendra Olguín, María Ignacia Urrutia |
| Track elegido | Track A · Caso real |
| Tipo declarado | Automatización / RPA + IA |
| Cliente | Universidad Adolfo Ibáñez — Área de Admisión (Admisión Especial) |
| Contacto del cliente | María Cristina Ortuza · cristina.ortuza@uai.cl |
| Repo | https://github.com/almendraolguinc-ux/Admision-UAI |
| Tag de entrega | v1.0-final |

---

## 2 · Resumen ejecutivo

El proceso actual de validación de antecedentes para la admisión especial de la UAI es manual y operativo: revisar más de 1.000 expedientes contra reglas de negocio (NEM, puntaje PAES por carrera, año de egreso) y verificar documentos adjuntos genera una carga administrativa alta y retrasa el paso de los postulantes a la etapa de entrevista.

Construimos un flujo automatizado en dos etapas — un robot RPA construido con Antigravity que filtra y valida postulantes contra las reglas de corte, y un workflow de n8n con un agente de IA (Gemini) que clasifica los resultados y gestiona la comunicación por correo — que actúa como primer filtro inteligente, distinguiendo entre postulantes aptos para entrevista, con reparos, o en revisión manual, y dejando la intervención humana solo para las entrevistas y excepciones complejas.

**Métrica que mueve:** costo de horas-hombre de revisión manual (~$2.598.000 CLP/mes en régimen actual) y la capacidad de absorber el peak de admisión de verano (5x el volumen de invierno) sin sobrecargar al equipo ni contratar personal adicional.

---

## 3 · Problema y solución

### El dolor

- Más de 1.000 expedientes por vía de admisión especial se revisan manualmente contra múltiples reglas de negocio cruzadas (NEM, puntaje PAES por carrera, año de egreso, existencia de documentos).
- La revisión manual consume recursos del equipo de Admisión y retrasa el flujo del postulante hacia la etapa de entrevista.
- Los errores humanos por fatiga (aprobar un documento vencido, calcular mal un requisito) son un riesgo real a ese volumen.

### La solución

Un flujo de dos piezas conectadas por Google Drive:

1. **Antigravity (RPA, corre lunes 7:00 AM):** se loguea en la plataforma de Admisión, descarga el Excel general, filtra por vía de postulación, y aplica las reglas de negocio (ver Sección 4) para clasificar cada postulante en un `RPA_Estado`. Para los aprobados, descarga las fichas (concentración de notas, licencia de enseñanza media) y valida la existencia de cédula/pasaporte. Sube todo — reporte y documentos — a una carpeta de Google Drive organizada en subcarpetas.
2. **n8n (corre lunes 10:00 AM):** tres horas después, toma el Excel consolidado que dejó Antigravity, lo clasifica por estado, y dispara la comunicación: correos directos a postulantes (pendientes/descartados) y reportes HTML generados por un agente de IA (Gemini) para la coordinadora, separando "aprobados para descarga" de "revisión manual".

### Por qué esta solución y no otra

- El cuello de botella real está en la validación cruzada de reglas (NEM + PAES + carrera + año de egreso), no en la recolección de documentos — automatizar solo la descarga no resuelve el problema.
- Se separó el RPA (scraping + reglas de negocio, requiere navegación web) del orquestador (n8n, mejor para ramificar y notificar) en vez de meter todo en un solo script: permite que cada pieza corra en su propio horario y se pueda depurar por separado.
- La clasificación final la valida un agente de IA en lenguaje natural (reporte HTML), pero las reglas duras (cortes de puntaje, año de egreso) están en código, no en el LLM — el LLM no decide quién entra, solo redacta el reporte para la coordinadora.

---

## 4 · Arquitectura

```
ANTIGRAVITY (RPA)                     GOOGLE DRIVE                    N8N (orquestador)
Lunes 7:00 AM                         (carpeta + subcarpetas)         Lunes 10:00 AM
+------------------------+                                            +---------------------------+
| 1. Login Admisión UAI  |                                            | Search files (Drive)       |
| 2. Descarga Excel      |                                            | -> Download resultado_     |
|    general             |                                            |    proceso_rpa.xlsx        |
| 3. Filtra vía          |----> resultado_proceso_rpa.xlsx  --------->| Extract from File (xlsx)   |
|    postulación         |      + PDFs por postulante                | -> Switch por RPA_Estado   |
| 4. Reglas de negocio:  |      (idempotente: no re-descarga          +---------------------------+
|    - Año egreso        |       si ya existe localmente)                |    |      |       |
|      2024/2025         |                                                v    v      v       v
|    - NEM/PAES vacíos   |                                          Pendiente  Descar-  Aprobado  Revisión
|      o en 0 -> Revisión|                                          Documentos tado     p/Descarga Manual
|      Manual            |                                             |         |         |         |
|    - Fuzzy match       |                                             v         v         v         v
|      carrera vs tabla  |                                          Email     Email    Aggregate  Aggregate
|      de cortes         |                                          directo   directo     |           |
| 5. Descarga fichas de  |                                          (postu-   (postu-     v           v
|    aprobados           |                                          lante)    lante)   AI Agent    AI Agent
| 6. Reevalúa TODOS los  |                                                              (Gemini)    (Gemini)
|    no-aprobados cada   |                                                                 |           |
|    corrida             |                                                                 v           v
+------------------------+                                                              Email a     Email a
                                                                                          coordinadora coordinadora
```

### Flujo de datos paso a paso

1. **7:00 AM** — Antigravity corre el RPA (`rpa_downloader.py`/`.js`), se loguea en la plataforma de Admisión UAI y descarga el Excel general de postulantes.
2. Filtra la vía de postulación (ej. "Desempeño Destacado en la Enseñanza Media") y aplica en orden: (a) filtro de año de egreso (solo 2024/2025), (b) chequeo de consistencia NEM/PAES (vacío o 0 → Revisión Manual), (c) mapeo difuso de carrera contra la tabla de cortes, (d) comparación de puntaje PAES contra el corte de la carrera.
3. Cada postulante queda etiquetado con un `RPA_Estado`: `Aprobado para Descarga`, `Descartado por Criterio`, `Pendiente de Documentos`, o `Revisión Manual`.
4. Para los aprobados, descarga concentración de notas y licencia de enseñanza media, valida (sin descargar) la existencia de cédula/pasaporte — con chequeo local (`fs.existsSync` / equivalente) para no re-descargar archivos ya procesados.
5. Sube el reporte consolidado (`resultado_proceso_rpa.xlsx`) y los documentos a una carpeta de Google Drive con subcarpetas por postulante.
6. **10:00 AM** — n8n busca el archivo en Drive, lo descarga y extrae los datos (`Extract from File`, xlsx).
7. Un nodo `Switch` rutea cada fila por `RPA_Estado` en 4 ramas.
8. Las ramas "Pendiente de Documentos" y "Descartado por Criterio" disparan un correo directo y personalizado al postulante (Gmail node, con `NombreCompleto`, `RPA_Motivo`, `DocumentosRequeridos`).
9. Las ramas "Aprobado para Descarga" y "Revisión Manual" agregan (`Aggregate`) la lista completa de postulantes de ese grupo y se la pasan a un AI Agent (Gemini 1.5 Flash, vía LangChain) que redacta un reporte HTML tabulado para la coordinadora.
10. El reporte HTML se envía por Gmail a la coordinadora del proceso.

---

## 5 · Las 4 verticales

| Vertical | Capa cumplida | Dónde está la evidencia |
|---|---|---|
| Automatización | Capa 1 (Retries, Continue on Fail y Error Trigger implementados) + Capa 2 (RPA construido con Antigravity, IDE agéntico) | `/src/flujo/rpa_downloader.py` o `.js`, documentación en `implementation_plan.md` y `2exp.md` |
| IA | Capa 1 (llamada a Gemini integrada, resultado usado en el correo final) + Capa 2 parcial (2 agentes con roles distintos: "Aprobado" y "Revisión Manual") | `My_workflow.json`, prompts de los AI Agents guardados en `/src/prompts/` |
| BBDD | Capa 1 (Excel/Drive como almacenamiento del resultado del proceso) | `resultado_proceso_rpa.xlsx` en Drive, estructura de subcarpetas |
| Front / Touchpoint | Capa 1 (explicado en Sección 6) | Sección 6 de este README |

> **Nota:** los mecanismos de resiliencia (Retries, Continue on Fail, Error Trigger) ya están implementados en el flujo, y los prompts de los AI Agents quedaron guardados como archivos independientes en `/src/prompts/` en vez de vivir escondidos dentro del nodo.

---

## 6 · Touchpoint del usuario

**Postulante:**
- No gatilla nada directamente — su postulación ya cargada en la plataforma de Admisión es tomada automáticamente cada lunes.
- Recibe un correo automático (Gmail, vía n8n) los lunes después de las 10:00 AM si su estado es "Pendiente de Documentos" o "Descartado por Criterio", con el motivo específico de su caso.

**Coordinadora / equipo de Admisión:**
- Recibe dos reportes HTML por correo cada lunes: uno con los postulantes "Aprobados para Descarga" y otro con los que requieren "Revisión Manual", ambos redactados por el AI Agent en formato tabla.
- Este correo es lo único que la coordinadora necesita revisar para saber quiénes pasan a la etapa de entrevista — reemplaza por completo la revisión manual/operativa fila por fila del Excel que se hacía antes. La intervención humana queda acotada a los casos de "Revisión Manual" y a las entrevistas mismas, no al filtrado inicial.

---

## 7 · Cómo correrlo

Setup mínimo para reproducir el flujo completo (RPA + n8n) con credenciales mock.

### 7.1 · Requisitos previos

- [Node.js](https://nodejs.org/) v18 o superior.
- Credenciales del portal de Admisión UAI (usuario y contraseña) — provistas en `/evidencia/credenciales-demo.md`.
- Cuenta de Google Drive de pruebas.

### 7.2 · Instalación

```bash
npm install
npx playwright install chromium
```

### 7.3 · Variables de entorno (`.env`)

```env
# Credenciales del Portal Admisión UAI
UAI_USER="callcenter01@uai.cl"
UAI_PASSWORD="TuPasswordMock"

# Opciones del RPA
HEADLESS=false
DOWNLOAD_DIR="descargas_postulantes"
REPORTE_FINAL="resultado_proceso_rpa.xlsx"

# Google Drive (carpeta destino)
DRIVE_FOLDER_ID="ID_De_Carpeta_Drive_Provisto"

# Mapeo de columnas del Excel de la UAI
COL_EMAIL="MAIL"
COL_PREFERENCIA="PrimeraPreferencia"
COL_PUNTAJE_PAES="MaximoPuntajePAESPrimeraPreferencia"
COL_NEM="PromedioNotasEnseñanzaMedia"
COL_DOCS_ENVIADOS="DocumentosRequeridosAdjuntos"
```

### 7.4 · Autenticación con Google Drive (OAuth2)

```bash
node auth_google.js
```
El script levanta un servidor local temporal y muestra una URL en consola. Ábrela, inicia sesión con la cuenta de Google de pruebas y autoriza los permisos. Al terminar, genera un `token.json` local con las llaves de acceso encriptadas.

### 7.5 · Ejecución del RPA

```bash
node rpa_downloader.js
```

Al ejecutarse, el robot:

1. Con las credenciales del `.env`, se loguea en el portal de Admisión UAI.
2. Busca manualmente (navega) dentro del portal la vía de Admisión "Desempeño Destacado en la Enseñanza Media" y descarga la planilla general de postulantes de esa vía.
3. Filtra estrictamente por `AñoEgreso` (solo procesa egresados 2024 y 2025; excluye el resto del reporte consolidado).
4. Deriva a **Revisión Manual** a quienes tengan NEM o Puntaje PAES vacíos o en cero.
5. Evalúa a los restantes contra la tabla de cortes por carrera (`reglas_corte.json`).
6. Para quienes sí cumplen el corte, vuelve a entrar al portal de Admisión y descarga desde ahí mismo su *Concentración de Notas* y *Licencia de Enseñanza Media*, y valida la existencia de su Cédula/Pasaporte — con chequeo de idempotencia: si el postulante ya tiene sus archivos en su subcarpeta local, se salta la navegación web para ese postulante.
7. Sube el reporte final a la subcarpeta `Base de Datos/` en Drive, y los documentos de los aceptados a `Aceptados/<ID>/` (una carpeta por postulante).

### 7.6 · n8n

1. Importar `My_workflow.json` en tu instancia de n8n.
2. Configurar credenciales: Google Drive OAuth2, Gmail OAuth2, Google Gemini (PaLM) API.
3. Ajustar el `folderId` del nodo "Search files and folders" a la carpeta `Base de Datos/` de Drive.
4. Reemplazar el "Manual Trigger" por un Schedule Trigger: lunes 10:00 AM.
5. Activar el workflow.

### 7.7 · Smoke test

**Prueba piloto real (1ª corrida):** se corrió el flujo completo con los 94 postulantes que postularon por la vía "Desempeño Destacado en la Enseñanza Media". Resultado de la clasificación:

| RPA_Estado | Cantidad |
|---|---|
| Aprobado para Descarga | 3 |
| Revisión Manual | 8 |
| Pendiente de Documentos (solicitud de documentos) | 45 |
| Descartado por Criterio (rechazo) | 37 |

El flujo completo —desde que corre el RPA hasta que se envían los correos finales— tomó **2 minutos**. La clasificación fue validada manualmente contra los 94 casos y resultó **100% correcta** frente al criterio de la coordinadora.

---

## 8 · Track A · ROI cuantificado

### 8.1 · Cliente identificado

Cliente: Universidad Adolfo Ibáñez — Área de Admisión (Admisión Especial). Contacto: María Cristina Ortuza (cristina.ortuza@uai.cl).

### 8.2 · Estado actual (baseline)

| Métrica | Valor |
|---|---|
| Horas/semana coordinadora en revisión manual | 20 hrs |
| Horas/semana asistente en revisión manual | 10 hrs |
| Costo/hora coordinadora | $27.500 CLP |
| Costo/hora asistente | $5.000 CLP |
| Postulantes — ingreso invierno | 1.200 / 4 meses (≈300/mes) |
| Postulantes — ingreso verano | 6.000 / 4 meses (≈1.500/mes, 5x el volumen de invierno) |
| Personal adicional contratado en peak de verano | Ninguno — el mismo staff absorbe los 5x del volumen |

### 8.3 · Resultado post-MVP

Piloto corrido con los 94 postulantes reales de la vía "Desempeño Destacado en la Enseñanza Media":

- **Tiempo de procesamiento:** 2 minutos desde que corre el RPA hasta que se envían los correos finales (vs. el ciclo manual actual, que toma horas/días).
- **Distribución de resultados:** 3 aprobados para descarga, 8 en revisión manual, 45 con solicitud de documentos, 37 descartados por criterio.
- **Precisión del clasificador:** 100% de los 94 casos coincidió con el criterio que habría aplicado la coordinadora — no hubo correcciones necesarias en esta corrida.
- **Nota de alcance del piloto:** en esta primera versión, los correos no se envían a los postulantes reales — todos los emails (incluidos los de "solicitud de documentos" y "rechazo") llegan al equipo del proyecto, no a las casillas de los postulantes, dado que es un MVP en fase de validación (ver Sección 9).

### 8.4 · ROI cuantificado

**Costo actual de la revisión manual**

| Concepto | Semanal | Mensual (x4,33) | Anual |
|---|---|---|---|
| Coordinadora (20 hrs/sem × $27.500/hr) | $550.000 | $2.381.500 | $28.600.000 |
| Asistente (10 hrs/sem × $5.000/hr) | $50.000 | $216.500 | $2.600.000 |
| **Total costo actual** | **$600.000** | **$2.598.000** | **$31.200.000** |

**Ahorro proyectado post-automatización**

> **Supuesto a validar con el piloto:** se asume que, con la automatización, la revisión manual queda acotada solo a los casos que caen en "Revisión Manual" (coordinadora baja a ~3 hrs/sem, asistente a ~1 hr/sem). Este número debe reemplazarse por la medición real una vez corrido el piloto.

| Concepto | Semanal | Mensual | Anual |
|---|---|---|---|
| Costo residual post-automatización (3 hrs coord. + 1 hr asist.) | $87.500 | $378.900 | $4.550.000 |
| **Ahorro bruto** | **$512.500** | **$2.219.000** | **$26.650.000** |
| Costo de la solución (n8n Pro + Google AI Pro, para Antigravity) | — | -$66.500 | -$798.000 |
| **Beneficio neto** | — | **$2.152.500** | **$25.850.000** |

*Costo de la solución estimado a partir de n8n Pro (~US$50/mes) + Google AI Pro (US$19,99/mes), convertido a CLP a un tipo de cambio referencial de ~$950 CLP/USD — ajustar al tipo de cambio vigente al momento de la entrega.*

**El argumento del peak de verano**

El equipo de Admisión trabaja con el mismo staff (20 + 10 hrs/sem) tanto para el ingreso de invierno (≈300 postulantes/mes) como para el ingreso de verano (≈1.500 postulantes/mes) — un volumen 5 veces mayor. Hoy ese peak se absorbe sin contratar personal adicional, lo que en la práctica significa sobrecarga del equipo existente y mayor riesgo de error humano o atraso justo en la temporada de mayor demanda de todo el año. Con la automatización, el costo marginal de procesar 5 veces más postulantes es prácticamente nulo (mismo plan de n8n/Gemini, solo aumenta el uso dentro de la cuota contratada), mientras que la carga de revisión manual —ya elevada en régimen normal— dejaría de escalar linealmente con el volumen. El beneficio aquí no es un ahorro monetario directo, sino la eliminación del cuello de botella operativo en el período más crítico del año para la universidad.

---

## 9 · Limitaciones y próximos pasos

- **Cobertura acotada:** de las aproximadamente 15 vías de Admisión Especial que tiene la UAI, este MVP solo automatiza 1 (Desempeño Destacado en la Enseñanza Media). Las otras 14 vías siguen con revisión 100% manual.
- **Créditos de la API de IA:** el plan actual de Gemini tiene un límite de créditos que se agota con el uso, y todavía no está resuelto por restricción de presupuesto del equipo. Si el volumen de postulantes crece o se agregan más vías, este es el primer cuello de botella técnico a resolver.
- **Los correos no llegan a los postulantes reales:** en esta versión MVP, todos los correos automáticos (solicitud de documentos, rechazo, reportes a la coordinadora) se envían al equipo del proyecto, no a las casillas reales de los postulantes ni de la coordinadora — es una limitación intencional mientras el proyecto está en fase de validación con el cliente.
- **Sin seguimiento conversacional:** si un postulante responde al correo (ej. "adjunto el documento que faltaba"), hoy nadie ni nada procesa esa respuesta. No hay un agente que dé continuidad a la conversación por correo.
- No hay procesamiento de casos "Pendiente de Documentos" reevaluados automáticamente en el mismo día — se reevalúan recién en la corrida semanal siguiente.
- Sin tests automatizados de regresión sobre las reglas de negocio (año de egreso, cortes por carrera).

> Nota: el mapeo de carreras contra la tabla de cortes no se considera un riesgo de interpretación, porque toda la información con la que trabaja el robot proviene de un Excel estructurado del portal de Admisión — los nombres de carrera, sedes y reglas de corte son fijos y no cambian de una corrida a otra, por lo que no requiere un modelo de similitud más robusto.

### Próximos pasos

- Extender el flujo a las 14 vías de Admisión Especial restantes.
- Resolver el límite de créditos de la API de IA (evaluar plan superior de Gemini o un modelo más económico para las llamadas de mayor volumen).
- Conectar el envío de correos a las casillas reales de postulantes y coordinadora, una vez validado con el cliente.
- Agregar un agente de IA que dé seguimiento a las respuestas de los postulantes por correo (ej. si responden confirmando el envío de un documento, que el sistema lo registre y actualice el estado sin intervención manual).

---

## 10 · Roles del equipo

| Integrante | Rol | Contribución principal |
|---|---|---|
| María Emilia Calvache | RPA / Antigravity | Construcción completa del robot: login y navegación en el portal de Admisión, lógica de filtrado (año de egreso, NEM/PAES, mapeo carrera-corte), descarga idempotente de documentos, subida estructurada a Drive |
| María Ignacia Urrutia | Orquestación / Workflow (n8n) | Diseño del flujo principal en n8n: nodo Switch por `RPA_Estado`, conexión con Google Drive (Search + Download + Extract from File) |
| Abrahan Aldenzon | IA / Agentes + Notificaciones (n8n) | Configuración de los AI Agents (Gemini), diseño de los prompts para los reportes de "Aprobado" y "Revisión Manual", nodos de Gmail (correos directos y reportes a coordinadora) — contacto y relación directa con el cliente (Área de Admisión UAI) |
| Pedro Bustos | QA del flujo (n8n) | Pruebas end-to-end del workflow completo, Aggregate, validación de los 4 estados |
| Almendra Olguín | Presentación + Documentación/Evidencia | Armado del pitch para S8 (3 min problema/solución + 5 min demo), captura de screenshots y evidencia para `/evidencia/`, apoyo en la redacción de las secciones de Problema/Solución y Resumen Ejecutivo del README |
