# Price Refresh Reliability Specification — Delta

## ADDED Requirements

### Requirement: FX Rate Cache Only Stores Validated Numeric Rates

The system MUST cache a value for a `from`/`to` currency pair only when that value is a validated, finite, non-zero numeric rate obtained from a successful FX provider response. The system MUST NOT cache a fallback or sentinel value in place of a missing or unparseable rate. A cached value MUST be indistinguishable from a real rate only when it genuinely is one — a legitimate rate that happens to equal `1` (a true 1:1 parity between two distinct currencies) MUST be cacheable and reusable exactly like any other numeric rate; the invalid case being excluded is an absent/malformed/non-numeric response, not the numeric value `1` itself.

#### Scenario: A malformed FX response body is not cached

- GIVEN a currency pair `from=USD`, `to=EUR` that is not yet cached
- WHEN the FX provider responds with an HTTP 200 status and a JSON body that has no usable `rates[EUR]` numeric value (e.g. missing key, `null`, or a non-numeric value)
- THEN the pair `USD/EUR` MUST NOT be written to the FX cache
- AND a subsequent call for the same pair MUST issue a new network request rather than returning a cached value

#### Scenario: A genuine numeric rate is cached and reused

- GIVEN a currency pair `from=USD`, `to=EUR` that is not yet cached
- WHEN the FX provider responds with an HTTP 200 status and a JSON body containing a valid numeric `rates[EUR]` value
- THEN that numeric value MUST be written to the FX cache for `USD/EUR`
- AND a subsequent call for the same pair within the same session MUST return the cached value without issuing a new network request

#### Scenario: A legitimate 1:1 rate between distinct currencies is cached like any other rate

- GIVEN a currency pair `from=XXX`, `to=YYY` (two distinct currency codes) that is not yet cached
- WHEN the FX provider responds with an HTTP 200 status and a JSON body containing a valid numeric `rates[YYY]` value equal to `1`
- THEN the value `1` MUST be written to the FX cache for `XXX/YYY`
- AND a subsequent call for the same pair MUST return the cached value `1` without issuing a new network request

#### Scenario: Same-currency requests never hit the network or the cache-validation path

- GIVEN a currency conversion is requested with `from` equal to `to`
- WHEN the FX rate is requested for that pair
- THEN the system MUST return `1` immediately
- AND MUST NOT issue a network request
- AND this short-circuit MUST NOT depend on or interact with the cache-validation behavior above

#### Scenario: A bad response does not poison later legitimate calls

- GIVEN a currency pair `from=USD`, `to=EUR` for which the FX provider returned a malformed or absent-rate response on a prior call in the same session
- WHEN a later call for the same pair is made and the FX provider responds with a valid numeric rate
- THEN the FX cache MUST be populated with the valid numeric rate
- AND that valid rate MUST be returned, not any prior fallback or sentinel value

### Requirement: Non-OK HTTP Responses Are Never Treated as Successful Data

The system's shared JSON-fetching helper used by the price-refresh flow (including `fetchFxRate`) MUST NOT treat an HTTP response with a non-`ok` status (outside the 200–299 range) as successful data, even when that response carries a syntactically valid JSON body.

#### Scenario: A non-ok response with a JSON error body is not treated as success

- GIVEN an outbound request in the price-refresh flow (including the FX rate request)
- WHEN the response has a non-`ok` HTTP status (e.g. 429 or 500) and a JSON-parseable body (e.g. `{"error": "rate limited"}`)
- THEN the response MUST NOT be treated as successful data
- AND the FX cache MUST NOT be written with any value derived from that response

#### Scenario: fetchFxRate never throws to its callers regardless of response validity

- GIVEN any combination of network failure, non-ok HTTP status, or malformed response body while resolving an FX rate
- WHEN `fetchFxRate` is called from either of its call sites in `app.js`
- THEN `fetchFxRate` MUST NOT throw or reject in a way that escapes its own handling
- AND the calling code path MUST continue executing exactly as it does on a successful call (including, at the `formAsset` submit handler call site, still creating the asset and its transaction)
