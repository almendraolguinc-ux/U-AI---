const fs = require('fs');
const http = require('http');
const url = require('url');
const { google } = require('googleapis');

// Scopes requeridos
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

async function autenticarGoogle() {
  console.log('🔑 Iniciando autenticación con Google Drive...');
  
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('❌ Error: No se encontró el archivo credentials.json.');
    process.exit(1);
  }

  const content = fs.readFileSync(CREDENTIALS_PATH);
  const credentials = JSON.parse(content);
  const { client_secret, client_id } = credentials.installed || credentials.web;
  
  const redirectUri = 'http://localhost:3000/oauth2callback';
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  // Levantar un servidor local temporal para recibir el código
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.indexOf('/oauth2callback') > -1) {
        const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
        const code = qs.get('code');
        console.log('✅ Código de autorización recibido de forma exitosa.');
        
        res.end('<h1>Autenticacion exitosa!</h1><p>Ya puedes cerrar esta ventana y regresar a la terminal.</p>');
        server.close();

        // Intercambiar el código por tokens
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        // Guardar token
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
        console.log(`💾 Token guardado con éxito en: ${TOKEN_PATH}`);
        console.log('🎉 Autenticación finalizada correctamente.');
        process.exit(0);
      }
    } catch (e) {
      console.error('❌ Error al procesar el callback:', e.message);
      res.end('<h1>Error de autenticacion</h1>');
      process.exit(1);
    }
  }).listen(3000, () => {
    // Generar URL de autenticación
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });

    console.log('\n=========================================');
    console.log('👉 POR FAVOR, ABRE EL SIGUIENTE ENLACE EN TU NAVEGADOR:');
    console.log(authUrl);
    console.log('=========================================\n');
    console.log('⏳ Esperando la respuesta en el puerto 3000...');
  });
}

autenticarGoogle();
