**Plataforma de Ajedrez Multijugador**

**Nombre: Freddy Jiménez**

Este repositorio aloja el código fuente de una aplicación interactiva diseñada para gestionar partidas de ajedrez en línea. El proyecto aplica los conceptos fundamentales de los sistemas distribuidos al separar la interfaz visual del servidor lógico. La plataforma permite a los jugadores ingresar de forma segura mediante sus credenciales de Google. El servidor sincroniza los movimientos del tablero al instante utilizando conexiones persistentes e incorpora un sistema matemático transaccional para actualizar los puntajes competitivos.

**Tecnologías integradas**

- Frontend: Interfaz gráfica construida con React y empaquetada mediante Vite.
- Backend: Entorno de operaciones desarrollado sobre el marco de trabajo NestJS.
- Comunicación: Transmisión de eventos bidireccionales impulsada por Socket.io.
- Base de datos: Almacenamiento relacional operado por MySQL y mapeado con TypeORM.

**Requisitos previos**

El sistema requiere la instalación de diversas herramientas para funcionar adecuadamente en tu equipo local.

- Node.js versión 20 o alguna versión superior.
- Servidor de base de datos MySQL en ejecución.
- Proyecto configurado en Google Cloud Console para obtener las credenciales de acceso delegado.

**Configuración de variables de entorno**

La plataforma utiliza variables de entorno para resguardar la información sensible. El directorio principal del backend contiene un archivo referencial llamado .env.example. Debes crear un archivo nuevo nombrado exactamente .env y completar los valores con tus configuraciones locales.

Contenido de ejemplo para el archivo .env del servidor backend:

# --- BASE DE DATOS MYSQL ---
DB\_HOST=mysql...
DB\_PORT=11111
DB\_USER=user
DB\_PASSWORD=password
DB\_NAME=dbname

# --- GOOGLE OAUTH 2.0 ---
GOOGLE\_CLIENT\_ID=345678908765
GOOGLE\_CLIENT\_SECRET=bhjbiuh89uiub
GOOGLE\_CALLBACK\_URL=http://localhost

# --- SEGURIDAD JWT Y FRONTEND ---
JWT\_SECRET=SECRET
FRONTEND\_URL=http://localhost

GMAIL_USER=correo@gmail.com
GMAIL_PASS=xxxx xxxx xxxx xxxx

PAYPAL\_CLIENT\_ID=234567890hjbjhbj
PAYPAL\_CLIENT\_SECRET=kbhiuhgiug9gh89g89g8vb89
PAYPAL\_BASE\_URL=https://api-m.sandbox.paypal.com

Contenido de ejemplo para el archivo .env del servidor frontend:

VITE\_PAYPAL\_CLIENT\_ID=r3fcefrewfc3rcferfr
VITE\_BACKEND\_URL=http://localhost

**Instrucciones de instalación y ejecución**

1. Sigue estos pasos ordenados para inicializar el proyecto completo sin inconvenientes.
2. Descarga el código del repositorio hacia tu máquina local.
3. Abre tu gestor de base de datos MySQL y crea un esquema vacío nombrado chess_db.
4. Asegúrate de que el servicio de Ollama esté encendido y tenga el modelo llama3 descargado (ollama run llama3).
5. Abre una terminal de comandos y navega hacia la carpeta del backend.
6. Genera el archivo .env basándote en el ejemplo del servidor mostrado anteriormente.
7. Ejecuta el comando npm install para descargar todas las dependencias lógicas.
8. Inicia el servidor central ingresando el comando npm run start:dev.
9. Abre una segunda terminal de comandos y navega hacia la carpeta del frontend.
10. Genera el archivo .env basándote en el ejemplo del frontend.
11. Ejecuta nuevamente npm install para incorporar las librerías visuales requeridas.
12. Levanta el entorno gráfico ejecutando el comando npm run dev.
13. Ingresa a la dirección local expuesta en la consola del frontend para comenzar a navegar por la aplicación.
