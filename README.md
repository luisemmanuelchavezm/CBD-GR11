# SQL a ERD

Aplicacion web estatica para:

- pegar o cargar un script SQL PostgreSQL,
- generar un ERD dentro de la propia app,
- analizar normalización e integridad del modelo,
- proponer un SQL normalizado a partir de heurísticas,
- exportar el diagrama a SVG,
- exportar el codigo Mermaid (`.mmd`).

## Como usarla

existen 2 formas, la primera es de manera local y la segunda de manera online:

1. 

```powershell
cd c:\Users\emman\OneDrive\Escritorio\cbd
py -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

Tambien puedes abrir `index.html` directamente y usar `Cargar .sql` para seleccionar cualquier script manualmente.

2. mediante el link https://sql-a-erd.onrender.com/



## Tour de uso

La aplicacion esta pensada para recorrer un script SQL PostgreSQL desde la entrada hasta la exportacion del diagrama.

### 1. Cargar el script

Tienes dos formas de empezar:

- pegar el SQL directamente en el cuadro `Script SQL`,
- pulsar `Cargar .sql` para seleccionar un archivo desde tu equipo.

La idea es que pegues un script con tablas, claves primarias y claves foraneas para que la app pueda reconstruir la estructura.

### 2. Generar el ERD

Cuando el script ya esta cargado, pulsa `Generar ERD`.

La aplicacion hace estas tareas:

- analiza el SQL y detecta tablas, columnas y restricciones,
- identifica relaciones entre tablas,
- construye un diagrama ER,
- genera el codigo Mermaid equivalente.

El resultado aparece en la parte derecha, dentro del panel del diagrama.

### 3. Leer el panel de salida

La zona derecha se divide en varias salidas utiles:

- `Diagrama y Mermaid`: muestra el ERD renderizado.
- `Código Mermaid`: muestra el texto Mermaid generado a partir del SQL.
- `Validación y normalización`: muestra observaciones estructurales del modelo.
- `Propuesta SQL normalizada`: muestra una propuesta heuristica de descomposicion cuando detecta problemas de diseño.

Esto permite comparar el modelo grafico con el texto Mermaid y con el analisis de normalizacion sin salir de la app.

### 4. Moverte por el diagrama

Una vez generado el ERD, puedes explorarlo con los controles del toolbar:

- `Zoom -` reduce el nivel de acercamiento.
- `100%` restablece la escala base.
- `Zoom +` acerca el diagrama.
- tambien puedes usar la rueda del mouse y arrastrar dentro del lienzo para desplazarte.

Esto es util cuando el script tiene muchas tablas y relaciones.

### 5. Copiar o exportar resultados

La aplicacion ofrece varias formas de sacar el resultado:

- `Copiar Mermaid` copia el codigo Mermaid al portapapeles.
- `Descargar .mmd` guarda el Mermaid en un archivo.
- `Descargar PNG` exporta el diagrama como imagen.
- `Descargar SVG` exporta el diagrama vectorial.

Si necesitas llevar el diagrama a documentacion tecnica o presentaciones, normalmente `SVG` es la mejor opcion; si solo quieres compartir rapido una vista, `PNG` suele ser suficiente.

### 6. Usar el boton Tabla normalizada

El boton `Tabla normalizada` no reemplaza tu SQL original. Lo que hace es ejecutar una revision heuristica del modelo para detectar posibles problemas de diseño.

Entre otras cosas, revisa:

- indicios de 1FN, 2FN y 3FN,
- atributos repetidos o descriptivos embebidos,
- dependencias sospechosas,
- oportunidades de separar entidades.

Cuando encuentra un caso mejorable, genera observaciones en `Validación y normalización` y propone una version SQL orientativa en `Propuesta SQL normalizada`.

### 7. Flujo recomendado

Si vas a usar la herramienta por primera vez, este es el recorrido mas util:

1. Carga o pega el script.
2. Pulsa `Generar ERD`.
3. Revisa el diagrama y el Mermaid generado.
4. Pulsa `Tabla normalizada` para ver observaciones de diseño.
5. Exporta el resultado en `.mmd`, `PNG` o `SVG` segun lo que necesites.

### 8. Que tipo de SQL entiende mejor

La app funciona mejor cuando el script contiene al menos estos patrones:

- `CREATE TABLE ...`
- claves primarias en linea o por `CONSTRAINT ... PRIMARY KEY`
- claves foraneas por `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES ...`

Si el SQL se aleja mucho de ese formato, la salida puede ser parcial o menos precisa.

## Alcance actual

El parser esta pensado para scripts con este formato:

- `CREATE TABLE ...`
- claves primarias en linea o via `CONSTRAINT ... PRIMARY KEY`
- claves foraneas via `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... REFERENCES ...`

## Botón Tabla normalizada

El botón `Tabla normalizada` no reescribe automáticamente el SQL original, pero genera dos salidas heurísticas:

- comprobaciones de 1FN, 2FN y 3FN,
- reglas de integridad estructural,
- observaciones de diseño,
- propuestas de descomposición cuando detecta columnas descriptivas embebidas o atributos repetidos,
- un bloque aparte con SQL sugerido para la descomposición detectada.

Ejemplo: si encuentra una tabla tipo `pedidos(id_pedido, cliente_nombre, cliente_direccion)`, propondrá separar `CLIENTES` y sustituir los atributos embebidos por `cliente_id`.