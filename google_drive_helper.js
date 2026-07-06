const fs = require('fs');
const { google } = require('googleapis');

const CREDENTIALS_PATH = 'credentials.json';
const TOKEN_PATH = 'token.json';

/**
 * Inicializa y retorna un cliente autorizado de Google Drive
 */
function obtenerClienteDrive() {
  if (!fs.existsSync(CREDENTIALS_PATH) || !fs.existsSync(TOKEN_PATH)) {
    throw new Error('Faltan archivos de autenticación (credentials.json o token.json). Ejecuta auth_google.js primero.');
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH));
  const { client_secret, client_id } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3000/oauth2callback');
  oAuth2Client.setCredentials(tokens);

  return google.drive({ version: 'v3', auth: oAuth2Client });
}

/**
 * Busca una carpeta por nombre y parent ID. Si no existe, la crea.
 */
async function obtenerOCrearCarpeta(drive, nombre, parentId = null) {
  let query = `name = '${nombre}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  } else {
    query += ` and 'root' in parents`;
  }

  try {
    const respuesta = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    const archivos = respuesta.data.files;
    if (archivos.length > 0) {
      console.log(`📁 Carpeta existente encontrada en Drive: "${nombre}" (ID: ${archivos[0].id})`);
      return archivos[0].id;
    }

    // Si no existe, crearla
    console.log(`📂 Creando nueva carpeta en Drive: "${nombre}"...`);
    const metadata = {
      name: nombre,
      mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const carpetaNueva = await drive.files.create({
      resource: metadata,
      fields: 'id'
    });

    console.log(`   Carpeta creada con éxito (ID: ${carpetaNueva.data.id})`);
    return carpetaNueva.data.id;
  } catch (error) {
    console.error(`❌ Error en obtenerOCrearCarpeta para "${nombre}":`, error.message);
    throw error;
  }
}

/**
 * Sube un archivo local a una carpeta específica en Google Drive
 */
async function subirArchivoADrive(drive, nombreDestino, rutaLocal, parentFolderId, mimeType = 'application/pdf') {
  if (!fs.existsSync(rutaLocal)) {
    throw new Error(`El archivo local no existe en la ruta: ${rutaLocal}`);
  }

  try {
    // Buscar si el archivo ya existe en la carpeta especificada
    const query = `name = '${nombreDestino}' and '${parentFolderId}' in parents and trashed = false`;
    const respuestaBusqueda = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    const archivosExistentes = respuestaBusqueda.data.files;
    const media = {
      mimeType: mimeType,
      body: fs.createReadStream(rutaLocal)
    };

    if (archivosExistentes.length > 0) {
      const fileId = archivosExistentes[0].id;
      console.log(`⬆️ Actualizando archivo existente en Drive: "${nombreDestino}" (ID: ${fileId})...`);
      
      const respuestaUpdate = await drive.files.update({
        fileId: fileId,
        media: media,
        fields: 'id, webViewLink'
      });

      console.log(`   ✅ Archivo actualizado con éxito. ID en Drive: ${respuestaUpdate.data.id}`);
      return {
        id: respuestaUpdate.data.id,
        link: respuestaUpdate.data.webViewLink
      };
    } else {
      console.log(`⬆️ Subiendo nuevo archivo a Drive: "${nombreDestino}"...`);
      
      const fileMetadata = {
        name: nombreDestino,
        parents: [parentFolderId]
      };

      const respuestaCreate = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, webViewLink'
      });

      console.log(`   ✅ Archivo subido con éxito. ID en Drive: ${respuestaCreate.data.id}`);
      return {
        id: respuestaCreate.data.id,
        link: respuestaCreate.data.webViewLink
      };
    }
  } catch (error) {
    console.error(`❌ Error al subir/actualizar el archivo "${nombreDestino}":`, error.message);
    throw error;
  }
}

/**
 * Descarga un archivo de Google Drive a local por su nombre y carpeta padre
 */
async function descargarArchivoDeDrive(drive, nombreArchivo, parentFolderId, rutaLocalDestino) {
  try {
    const query = `name = '${nombreArchivo}' and '${parentFolderId}' in parents and trashed = false`;
    const respuesta = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    const archivos = respuesta.data.files;
    if (archivos.length === 0) {
      console.log(`ℹ️ No se encontró el archivo "${nombreArchivo}" en Drive. Se omitirá la descarga.`);
      return false;
    }

    const fileId = archivos[0].id;
    console.log(`⬇️ Descargando archivo "${nombreArchivo}" desde Drive (ID: ${fileId})...`);

    const dest = fs.createWriteStream(rutaLocalDestino);
    const res = await drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    return new Promise((resolve, reject) => {
      res.data
        .on('end', () => {
          console.log(`   ✅ Archivo guardado localmente en: ${rutaLocalDestino}`);
          resolve(true);
        })
        .on('error', err => {
          console.error('   ❌ Error en el stream de descarga:', err.message);
          reject(err);
        })
        .pipe(dest);
    });
  } catch (error) {
    console.error(`❌ Error al descargar el archivo "${nombreArchivo}":`, error.message);
    return false;
  }
}

module.exports = {
  obtenerClienteDrive,
  obtenerOCrearCarpeta,
  subirArchivoADrive,
  descargarArchivoDeDrive
};
