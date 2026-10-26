# Open model integration

## What is used

CommitPilot targets **any OpenAI-compatible chat-completions endpoint serving open weights**. It does not bundle or proxy a proprietary model.

Recommended default: **Qwen2.5-Coder** (`qwen2.5-coder:7b-instruct` or `32b-instruct`), released by Alibaba Cloud under **Apache-2.0**. It is available through Ollama locally and through several hosted providers. 7B runs acceptably on CPU for short reviews; 32B needs a GPU or a hosted endpoint.

Other compatible choices with their own terms:

| Model | Licence | Note |
| --- | --- | --- |
| Qwen2.5-Coder 7B/32B | Apache-2.0 | recommended default |
| Mistral 7B Instruct | Apache-2.0 | smaller, faster, weaker at code |
| Llama 3.1 8B Instruct | Llama 3.1 Community Licence | not OSI open source; review terms |
| DeepSeek-Coder V2 | model-specific licence | check redistribution terms |

The licence belongs to the model you configure, not to CommitPilot. Selecting a model whose API is "OpenAI-compatible" does **not** make it open source. Record the model and licence you actually use.

## Configuration

Environment (both processes) or Settings (web UI):

| Setting | Env | Notes |
| --- | --- | --- |
| Base URL | `OPENMODEL_BASE_URL` | Must end at the API root, e.g. `http://127.0.0.1:11434/v1` |
| Model id | `OPENMODEL_MODEL` | Provider-specific id |
| API key | `OPENMODEL_API_KEY` or Settings | Settings wins; encrypted at rest; never returned |
| Timeout | `OPENMODEL_TIMEOUT_MS` | Default 120000 |
| Retries | `OPENMODEL_MAX_RETRIES` | Default 1, capped at 3 |
| Context budget | `OPENMODEL_MAX_CONTEXT_CHARS` | Default 120000 characters |
| JSON mode | `OPENMODEL_JSON_MODE` | Default true; falls back once if the server rejects it |

Ollama:

```bash
ollama pull qwen2.5-coder:7b-instruct
```

```dotenv
OPENMODEL_BASE_URL=http://127.0.0.1:11434/v1
OPENMODEL_MODEL=qwen2.5-coder:7b-instruct
```

Hosted example (replace with a provider you have verified):

```dotenv
OPENMODEL_BASE_URL=https://<provider>/api/v1
OPENMODEL_MODEL=<open-model-id>
OPENMODEL_API_KEY=<key>
```

Then allow remote use in Settings. A non-loopback endpoint is refused until you do.

## Request shape

`POST {baseUrl}/chat/completions`

```json
{
  "model": "qwen2.5-coder:7b-instruct",
  "messages": [
    { "role": "system", "content": "…rules + required JSON shape…" },
    { "role": "user", "content": "…repository metadata, fenced <file> evidence, request…" }
  ],
  "temperature": 0.1,
  "max_tokens": 4000,
  "stream": false,
  "response_format": { "type": "json_object" }
}
```

The system prompt states that repository content is untrusted data, that the model must not invent paths or tests, and that it must return a single JSON object. Source excerpts are wrapped in `<file path="…">` elements with line-number prefixes.

## Response shape

```json
{
  "summary": "string",
  "architecture": "string or null",
  "findings": [
    {
      "category": "correctness|security|performance|maintainability|testing|architecture|data|other",
      "severity": "critical|high|medium|low|info",
      "title": "string",
      "description": "string",
      "evidence": "string",
      "filePath": "string or null",
      "startLine": 12,
      "endLine": 12,
      "confidence": "high|medium|low",
      "remediation": "string"
    }
  ],
  "nextSteps": ["string"],
  "limitations": "string or null"
}
```

The patch flow returns `{ title, rationale, files, unifiedDiff, notes }`; the search summary returns `{ answer, files }`.

## Validation and normalisation

`src/server/models/validation.ts` is strict about the envelope and tolerant about individual entries:

- JSON fences and leading prose are stripped; a balanced `{…}` is extracted if needed.
- Severity/category aliases are normalised (`moderate` → `medium`, `bug` → `correctness`).
- Findings without a title or description are dropped.
- If every finding is malformed, the response is rejected (`MODEL_INVALID_RESPONSE`).
- Absolute paths, Windows drive paths, `..`, and overlong paths become `null`.
- Line numbers outside the file are removed and the finding is downgraded.
- Secrets in titles, descriptions, evidence, and remediation are redacted before persistence.

## Context management

| Control | Behaviour |
| --- | --- |
| File selection | Deterministic scoring: source entry points, manifests, question keywords, path depth; test files boosted for test-gap runs |
| File cap | Up to 26 files per analysis, 5 target files per patch |
| Per-file cap | 9,000 characters (head + tail with an omission marker) |
| Total budget | ~70% of `maxContextChars`, enforced while building the prompt |
| Size caps | 256 KB per file, 2,000 tracked files by default |
| Diff cap | 200 KB, then truncated with a marker |
| Line prefixes | Every excerpt is line-numbered so the model can cite real lines |

## Failure behaviour

| Condition | Result |
| --- | --- |
| Endpoint not configured | `MODEL_NOT_CONFIGURED`; no job report |
| Remote endpoint without consent | `MODEL_NOT_CONFIGURED` (privacy block) |
| Connection refused / DNS failure | `MODEL_UNAVAILABLE`, one bounded retry |
| 401/403 | `MODEL_UNAVAILABLE` — credentials rejected |
| 429 | `MODEL_RATE_LIMITED`, retried with backoff |
| 5xx | `MODEL_UNAVAILABLE`, retried with backoff |
| Timeout | `MODEL_TIMEOUT` |
| Oversized response (>2 MB) | `MODEL_INVALID_RESPONSE` |
| Non-JSON content | `MODEL_INVALID_RESPONSE` |
| Invalid envelope | `MODEL_INVALID_RESPONSE` |

Deterministic workflows (security scan, test-gap mapping, inspect, search) keep working when the model is down. Model-dependent analysis and review fail visibly instead of producing a fabricated report.

## Privacy implications

Repository excerpts are transmitted to the configured endpoint. With a loopback endpoint, data stays on the machine. With a hosted endpoint, the provider's logging and retention policies apply. Mitigations:

- Mandatory exclusion of `.env`, keys, credential files, dependency/build directories, and binaries.
- Credential-pattern redaction before transmission.
- The **Preview context** button lists exactly which files and how many characters would be sent.
- Remote use is opt-in.
- No prompts or file contents are logged; only sizes, latencies, and outcomes.

## Known model limitations

- Small models may miss subtle bugs or produce plausible-but-wrong findings. The app labels every model finding as a hypothesis.
- JSON-mode support varies; some servers need the fallback path.
- Very large repositories are sampled, not fully understood. The report states when evidence was omitted or truncated.
- The model cannot run tests, inspect unimplemented branches, or confirm exploitability.