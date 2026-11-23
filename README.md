<p align="center">
  <img src="docs/images/logo.png" alt="Tag Companion" width="520">
</p>

<p align="center">
  <strong>Veja o que os seus tags de marketing <em>realmente</em> enviaram.</strong><br>
  Extensão do Chrome (Manifest V3) para quem implementa e audita GTM, GA4, Meta Pixel, Google Ads e cia.
</p>

<p align="center">
  <img alt="Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-F26B3A">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-231C19">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-231C19">
  <img alt="Testes" src="https://img.shields.io/badge/testes-30%20passando-2E7D4F">
</p>

---

O Tag Assistant mostra o que o GTM *decidiu* disparar. O **Tag Companion** mostra o que saiu de verdade pela rede: cada push do `dataLayer`, cada hit decodificado, o estado do Consent Mode v2, os cookies de marketing e nove diagnósticos automáticos — inclusive de tags fixos no código, fora do GTM.

![Painel do Tag Companion no DevTools](docs/images/devtools.png)

## Sumário

- [O que ele mostra](#o-que-ele-mostra)
- [Os quatro estados de um tag](#os-quatro-estados-de-um-tag)
- [Arquitetura](#arquitetura)
  - [Visão geral](#visão-geral)
  - [O caminho de um evento](#o-caminho-de-um-evento)
  - [Coleta em três mundos](#coleta-em-três-mundos)
  - [Núcleo: da requisição ao diagnóstico](#núcleo-da-requisição-ao-diagnóstico)
  - [Módulos de vendor](#módulos-de-vendor)
  - [Permissões e privacidade](#permissões-e-privacidade)
- [Diagnósticos automáticos](#diagnósticos-automáticos)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Como rodar](#como-rodar)

## O que ele mostra

| Aba | Para que serve |
| --- | --- |
| **Por Vendor** | Cada biblioteca carregada com os hits que ela disparou logo abaixo. Os números no topo filtram a lista (tudo, só carregado, só disparado, alertas). |
| **Linha do tempo** | `dataLayer`, hits, scripts, consentimento, cookies e navegações em ordem cronológica, com busca. |
| **Diagnósticos** | Os problemas que a extensão encontrou sozinha, com severidade e próximo passo. |
| **Consentimento & Cookies** | Estado atual do Consent Mode v2 (`gcs`, `gcd`), histórico de mudanças e cookies de marketing criados antes ou depois do consentimento. |

Clicar em qualquer item abre o **inspetor**: parâmetros decodificados com nome legível, consentimento no momento do hit, o push do `dataLayer` que o originou e a URL completa.

![Inspetor de um hit do GA4](docs/images/inspector.png)

Funciona em dois lugares, com a mesma interface:

<table>
  <tr>
    <td width="62%"><img src="docs/images/diagnostics.png" alt="Diagnósticos no DevTools"></td>
    <td width="38%"><img src="docs/images/sidepanel.png" alt="Side Panel do Chrome"></td>
  </tr>
  <tr>
    <td align="center"><b>DevTools → aba Tags</b><br>tela larga, inspetor ao lado</td>
    <td align="center"><b>Side Panel</b><br>clique no ícone da extensão</td>
  </tr>
</table>

## Os quatro estados de um tag

A forma diz o estado antes da cor, para continuar legível para quem não distingue vermelho de verde.

![Carregado, Disparado, Falhou, Carregou mas não disparou](docs/images/states.svg)

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Carregado: script do vendor chega
    Carregado --> Disparado: hit com resposta 2xx/3xx
    Carregado --> Falhou: ERR_ABORTED, ERR_BLOCKED_BY_CLIENT, 4xx/5xx
    Carregado --> CarregouNaoDisparou: nenhum hit após o carregamento
    Disparado --> Disparado: novos hits
    CarregouNaoDisparou --> Disparado: um hit chega depois
    CarregouNaoDisparou: Carregou, não disparou
```

## Arquitetura

### Visão geral

A extensão tem quatro peças que conversam por mensagens do Chrome. Tudo o que é coletado converge para o **service worker**, que mantém uma sessão por aba e a transmite em tempo real para a interface.

```mermaid
flowchart LR
    subgraph PAGE["🌐 Página inspecionada"]
        direction TB
        DL["window.dataLayer<br/>gtag() · fbq() · _hsq"]
        OBS["page-observer<br/><i>mundo MAIN</i>"]
        BR["content-bridge<br/><i>mundo ISOLATED</i>"]
        DL -. intercepta .-> OBS
        OBS -- window.postMessage --> BR
    end

    subgraph NET["📡 Rede do navegador"]
        WR["chrome.webRequest<br/>onBeforeRequest · onCompleted · onErrorOccurred"]
        CK["chrome.cookies.onChanged"]
    end

    subgraph DT["🛠️ DevTools"]
        NB["network-bridge<br/>chrome.devtools.network"]
    end

    SW["⚙️ <b>Service worker</b><br/>session-store: uma TabSession por aba<br/>core: vendors · consent · correlator<br/>diagnostics · pii"]

    subgraph UI["🖥️ Interface React"]
        PANEL["Painel Tags<br/>(DevTools)"]
        SIDE["Side Panel"]
    end

    BR -- PAGE_OBSERVER_EVENT --> SW
    WR --> SW
    CK --> SW
    NB -- "DEVTOOLS_NETWORK_REQUEST<br/>POST completo + initiator" --> SW
    SW == "SESSION_UPDATE (port)" ==> PANEL
    SW == "SESSION_UPDATE (port)" ==> SIDE
    UI -. comandos .-> SW

    classDef page fill:#FFF4EE,stroke:#F26B3A,color:#231C19
    classDef core fill:#231C19,stroke:#231C19,color:#FAF8F6
    classDef ui fill:#F3EFEC,stroke:#B9AFA8,color:#231C19
    class DL,OBS,BR page
    class SW core
    class PANEL,SIDE ui
```

As mensagens trocadas (`RuntimeMessage` em `src/shared/types.ts`):

| Mensagem | De → para | Para quê |
| --- | --- | --- |
| `PAGE_OBSERVER_EVENT` | content-bridge → service worker | Push do `dataLayer`, comando de consentimento, global de vendor, contexto da página. |
| `DEVTOOLS_NETWORK_REQUEST` | network-bridge → service worker | Requisição com corpo POST completo e pilha do initiator. |
| `SESSION_UPDATE` | service worker → interface | A sessão inteira da aba, a cada mudança. |
| `GET_SESSION` · `CLEAR_SESSION` · `SET_PRESERVE_LOG` | interface → service worker | Carregar, limpar e manter o registro entre navegações. |
| `ACTIVATE_ORIGIN` · `CHECK_ORIGIN_PERMISSION` | interface → service worker | Ativar a observação no site atual. |

| Peça | Arquivo | Papel |
| --- | --- | --- |
| Service worker | `src/background/service-worker.ts` | Escuta rede, cookies e mensagens; guarda a sessão por aba em `chrome.storage.session`; registra os scripts de observação só nos sites ativados. |
| Observador da página | `src/collectors/page-observer-core.ts` | Roda no mundo `MAIN` em `document_start`, envolve `dataLayer.push` e `gtag()` e detecta globais de vendors. |
| Ponte de conteúdo | `src/collectors/content-bridge.ts` | Mundo `ISOLATED`: recebe o `postMessage` da página e repassa ao service worker. |
| Ponte do DevTools | `src/devtools/network-bridge.ts` | Completa os hits com o corpo POST inteiro (lotes do GA4) e a pilha do initiator, usada para saber se o tag veio do GTM. |
| Interface | `src/ui/` | React 19 + Tailwind 4, a mesma árvore para o painel do DevTools e o Side Panel. |

### O caminho de um evento

Um `purchase` empurrado pelo código da loja, do `dataLayer.push` até a tela:

```mermaid
sequenceDiagram
    autonumber
    participant App as Código da loja
    participant Obs as page-observer (MAIN)
    participant Br as content-bridge (ISOLATED)
    participant SW as Service worker
    participant Net as webRequest
    participant UI as Painel / Side Panel

    App->>Obs: dataLayer.push({ event: "purchase", ... })
    Obs->>Br: postMessage({ type: "datalayer_push" })
    Br->>SW: PAGE_OBSERVER_EVENT
    SW->>SW: registra o evento na TabSession
    Note over App,Net: o GTM reage ao push e dispara os tags
    Net->>SW: onBeforeRequest /g/collect?en=purchase
    SW->>SW: vendors.ga4.parse() → ParsedHit
    SW->>SW: correlator: event_id exato ou janela de 3 s
    Net->>SW: onCompleted 204
    SW->>SW: status = disparado · runDiagnostics()
    SW-->>UI: SESSION_UPDATE (sessão inteira, pela port)
    UI->>UI: re-render: hit aparece sob GA4, ligado ao push
```

### Coleta em três mundos

O Chrome isola o JavaScript da extensão do JavaScript da página. Para ler o `dataLayer` *e* falar com o service worker, a coleta é feita em três camadas:

```mermaid
flowchart TB
    subgraph MAIN["Mundo MAIN — mesmo JS da página"]
        A["page-observer-core.ts<br/>• envolve dataLayer.push<br/>• reaplica o wrapper quando o GTM sobrescreve push<br/>• lê google_tag_data.ics (consentimento)<br/>• detecta fbq, clarity, _linkedin_data_partner_ids, _hsq"]
    end
    subgraph ISO["Mundo ISOLATED — content script"]
        B["content-bridge.ts<br/>aceita só mensagens com source = tag-companion-main"]
    end
    subgraph EXT["Contexto da extensão"]
        C["service-worker.ts"]
    end
    A -- "window.postMessage" --> B
    B -- "chrome.runtime.sendMessage" --> C
```

Por isso a extensão enxerga tags que **não** passam pelo GTM: um `fbq('track')` fixo no HTML ou um `dataLayer.push` feito pelo React aparecem igual, e o initiator de cada requisição diz se o hit veio do `gtm.js`, de um sGTM em domínio próprio ou de um script fixo na página.

### Núcleo: da requisição ao diagnóstico

Tudo em `src/core/` é TypeScript puro, sem APIs do Chrome, e por isso é coberto por testes unitários.

```mermaid
flowchart LR
    REQ["RawNetworkRequest"] --> MATCH{"vendors.match(url)"}
    MATCH -- script --> SCR["LoadedScript"]
    MATCH -- hit --> PARSE["vendor.parse()"] --> HIT["ParsedHit<br/>params com rótulo legível"]
    MATCH -- nada --> IGN["ignorado"]
    HIT --> CONS["consent.ts<br/>decodifica gcs / gcd"]
    HIT --> CORR["correlator.ts<br/>event_id ou janela de 3 s"]
    PUSH["DataLayerEvent"] --> CORR
    CK["MarketingCookie"] --> DIAG
    SCR --> DIAG
    CONS --> DIAG["diagnostics.ts<br/>9 regras"]
    CORR --> DIAG
    DIAG --> SESS[("TabSession")]
    SESS --> PII["pii.ts<br/>mascara e-mail, telefone, hashes"]
    PII --> OUT["UI · exportação JSON"]
```

| Módulo | Responsabilidade |
| --- | --- |
| `session-store.ts` | Máquina de estado da sessão: registra requisições, eventos da página, cookies e navegações; monta os grupos "Por Vendor". |
| `consent.ts` | Decodifica `gcs` e `gcd` do Consent Mode v2, comandos `gtag('consent')` e `google_tag_data.ics`. |
| `correlator.ts` | Liga cada push do `dataLayer` aos hits que ele gerou: `event_id` exato ou janela de 3 s, com equivalências semânticas (`purchase` ↔ `conversion` ↔ `CompletePayment`). |
| `diagnostics.ts` | As nove regras automáticas (tabela abaixo). |
| `pii.ts` | Detecta e mascara PII na tela e na exportação. |
| `exporter.ts` | Gera o JSON da sessão, sempre com PII mascarada. |

### Módulos de vendor

Cada vendor é um módulo independente com a mesma interface. Adicionar um vendor novo é escrever um arquivo e registrá-lo em `src/vendors/index.ts`.

```ts
export interface VendorModule {
  id: VendorId;
  name: string;
  category: VendorCategory;              // tag_manager | analytics | ads | crm | session_replay
  match(url: string, resourceType?: string): VendorMatch | null;  // é script ou hit?
  parse(request: RawNetworkRequest): ParsedHit[];                 // um request pode ter N hits (lotes do GA4)
  label(param: string): string;                                   // "epn.value" → "Evento (num): value"
}
```

```mermaid
mindmap
  root((Vendors))
    Tag manager
      GTM web
      sGTM em domínio próprio
    Analytics
      GA4
      Mixpanel
    Ads
      Google Ads
      Meta Pixel
      LinkedIn Insight
      TikTok Pixel
      Reddit Pixel
      X Pixel
    CRM
      HubSpot
    Session replay
      Microsoft Clarity
```

### Permissões e privacidade

A extensão **não** pede `<all_urls>` na instalação. Os domínios dos vendors vêm declarados no manifesto; o site que você está depurando só é observado depois que você clica em **Ativar neste site**.

```mermaid
flowchart TD
    A([Você abre o painel em loja.exemplo.com.br]) --> B{O site já foi ativado?}
    B -- não --> C[Faixa âmbar: Ativar neste site]
    C --> D["chrome.permissions.request<br/>*://loja.exemplo.com.br/* e subdomínios"]
    D -- negado --> E[Só hits de rede dos vendors]
    D -- concedido --> F["registerContentScripts<br/>observer MAIN + bridge ISOLATED"]
    B -- sim --> F
    F --> G[dataLayer, cookies de marketing e hits bloqueados]
    G --> H[(chrome.storage.session<br/>apagado ao fechar a aba)]
```

![Pedido de permissão por site](docs/images/permission.png)

- **Tudo local:** nenhum dado sai do navegador; a sessão vive em `chrome.storage.session` e é apagada ao fechar a aba.
- **PII mascarada por padrão:** e-mails, telefones e hashes aparecem mascarados na tela e sempre mascarados no JSON exportado. O botão **PII oculta** revela os valores só na sua tela.

## Diagnósticos automáticos

| Regra | O que detecta | Severidade típica |
| --- | --- | --- |
| `tag_before_consent` | Hit de mídia ou cookie de marketing criado com `ad_storage = denied` (o ping sem cookies do GA4 com `gcs=G100` é aceito). | Alta |
| `hit_lost` | Requisição com `ERR_ABORTED`, `ERR_BLOCKED_BY_CLIENT` ou HTTP 4xx/5xx — aparece como "disparado" no Tag Assistant, mas não chegou ao vendor. | Alta |
| `event_without_hit` | Evento de conversão no `dataLayer` (`purchase`, `generate_lead`…) sem nenhum hit em 5 s. | Alta |
| `duplicate_hit` | O mesmo evento enviado duas vezes ao mesmo vendor em 2 s, ou pelo GTM e por um script fixo. | Média |
| `missing_dedup_key` | Conversão sem `eid` / `event_id`, necessária para deduplicar navegador e servidor (CAPI). | Média |
| `wrong_property` | Mais de uma propriedade GA4 ou container GTM na mesma página. | Média |
| `pii_in_url` | E-mail ou telefone em texto puro na URL do hit. | Alta |
| `click_id_not_stored` | `gclid` / `fbclid` na URL sem o cookie correspondente (`_gcl_aw`, `_fbc`) depois de 3 s. | Média |
| `loaded_no_fire` | Biblioteca carregada que nunca disparou. | Baixa |

## Estrutura do projeto

```text
tag-companion/
├── manifest.json              # MV3: permissões, side panel, devtools_page
├── devtools.html · panel.html · sidepanel.html
├── src/
│   ├── background/            # service worker + coletor de cookies
│   ├── collectors/            # observador MAIN e ponte ISOLATED
│   ├── devtools/              # registro do painel "Tags" e ponte de rede
│   ├── core/                  # sessão, consentimento, correlação, diagnósticos, PII, exportação
│   ├── vendors/               # um módulo por vendor
│   ├── shared/                # tipos e constantes
│   └── ui/                    # React: App, componentes, tokens de design
├── preview/                   # UI com dados de exemplo, sem precisar da extensão
├── tests/                     # Vitest
├── demo/test-site.html        # página com cenários de teste
├── public/icons · public/fonts
└── scripts/                   # build (Vite) e instalação
```

## Como rodar

```bash
pnpm install
pnpm test        # 30 testes: vendors, consentimento, correlação, diagnósticos, PII, sessão, observador
pnpm build       # gera dist/
```

1. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e escolha a pasta `dist/`.
3. Abra um site (ou `npx serve demo` para a página de teste).
4. Clique no ícone do **Tag Companion** para o Side Panel, ou abra o DevTools → aba **Tags**.
5. Clique em **Ativar neste site** e recarregue a página.

**Mexendo só na interface?** `pnpm preview:ui` abre a UI com uma sessão de exemplo em `http://localhost:5199/preview/index.html` (`?mode=sidepanel` para o painel estreito, `&nogrant` para o estado sem permissão). Os dados do preview são fictícios.
