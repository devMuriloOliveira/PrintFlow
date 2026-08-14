# PrintFlow 3D

Projeto organizado em duas partes:

- `FrontEnd`: aplicacao Nuxt 4 com Vue 3.
- `BackEnd`: pasta reservada para a API/backend.

## Executar o BackEnd

Pela raiz do projeto:

```powershell
npm.cmd run dev:back
```

A API local sobe em `http://localhost:3333`.

Rotas disponiveis:

- `GET /api/app-data`
- `GET /api/products`
- `POST /api/products`
- `GET /api/orders`
- `GET /api/expenses`
- `GET /api/filaments`
- `GET /api/printers`
- `GET /api/marketplaces`
- `GET /api/clients`
- `GET /api/expense-segments`

## Executar o FrontEnd

Pela raiz do projeto:

```powershell
npm.cmd run dev:front
```

Por padrao, o front aponta para `https://printflow-api-4y5l.onrender.com`.

Para testar com a API local:

```powershell
npm.cmd run dev:front:local-api
```

Ou diretamente na pasta do front:

```powershell
cd FrontEnd
npm.cmd install
npm.cmd run dev
```

Acesse `http://localhost:3000`.
