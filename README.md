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

Contenido de ejemplo para el archivo .env del servidor:

Plaintext

DB\_HOST=localhost

DB\_PORT=3306

DB\_USER=root

DB\_PASSWORD=tu\_contrasena\_de\_mysql

DB\_NAME=chess\_db

JWT\_SECRET=tu\_clave\_secreta\_para\_firmar\_tokens

GOOGLE\_CLIENT\_ID=tu\_cliente\_id\_generado\_en\_google

GOOGLE\_CLIENT\_SECRET=tu\_secreto\_generado\_en\_google

**Instrucciones de instalación y ejecución**

Sigue estos pasos ordenados para inicializar el proyecto completo sin inconvenientes.

1. Descarga el código del repositorio hacia tu máquina local.
1. Abre tu gestor de base de datos MySQL y crea un esquema vacío nombrado chess\_db.
1. Abre una terminal de comandos y navega hacia la carpeta del backend.
1. Genera el archivo .env basándote en el ejemplo mostrado anteriormente.
1. Ejecuta el comando npm install para descargar todas las dependencias lógicas.
1. Inicia el servidor central ingresando el comando npm run start:dev.
1. Abre una segunda terminal de comandos y navega hacia la carpeta del frontend.
1. Ejecuta nuevamente npm install para incorporar las librerías visuales requeridas.
1. Levanta el entorno gráfico ejecutando el comando npm run dev.
1. Ingresa a la dirección local expuesta en la consola del frontend para comenzar a navegar por la aplicación.

