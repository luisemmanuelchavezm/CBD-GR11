# SQL a ERD

Aplicacion web estatica para:

- pegar o cargar un script SQL PostgreSQL,
- generar un ERD dentro de la propia app,
- analizar normalización e integridad del modelo,
- proponer un SQL normalizado a partir de heurísticas,
- exportar el diagrama a SVG,
- exportar el codigo Mermaid (`.mmd`).

## Como usarla

La forma mas simple es servir la carpeta por HTTP:

```powershell
cd c:\Users\emman\OneDrive\Escritorio\cbd
py -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

Tambien puedes abrir `index.html` directamente y usar `Cargar .sql` para seleccionar cualquier script manualmente.

## Despliegue en Render

La aplicacion es estatica, asi que en Render debe publicarse como `Static Site`.

Este repositorio ya incluye [render.yaml](render.yaml) con una configuracion minima para Render Blueprint:

```yaml
services:
  - type: web
    name: sql-a-erd
    runtime: static
    autoDeployTrigger: commit
    buildCommand: echo "Static site ready"
    staticPublishPath: .
```

Pasos:

1. Sube este proyecto a GitHub o GitLab.
2. En Render, entra a `New +` -> `Blueprint` si quieres que lea `render.yaml`, o `New +` -> `Static Site` si prefieres configurarlo manualmente.
3. Conecta el repositorio.
4. Si usas `Blueprint`, Render tomara la configuracion del archivo automaticamente.
5. Si lo haces manualmente, usa la rama `main` y estos valores:
   `Build Command`: `echo "Static site ready"`
   `Publish Directory`: `.`
6. Crea el servicio y espera el primer deploy.

Resultado esperado: Render servira [index.html](index.html) como sitio estatico y todos los archivos de la raiz quedaran publicados.

## GitHub

El repositorio remoto ya esta conectado a GitHub y la rama de trabajo publicada es `main`.

Para terminar de limpiar ramas en GitHub:

1. Entra al repositorio en GitHub.
2. Ve a `Settings` -> `Branches`.
3. Cambia la rama por defecto de `master` a `main`.
4. Borra la rama remota `master`.

Si quieres hacerlo por consola despues de cambiar la rama por defecto en GitHub, usa:

```powershell
git push origin --delete master
```

Una vez conectado a Render, cada push a `main` puede disparar un nuevo deploy automatico.

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