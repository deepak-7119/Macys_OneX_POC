# Source-informed behavior and deliberate POC differences

This POC does not wrap the JSP applications in iframes and does not run their
production backends. It implements selected modern journeys using new React
code, explicit API contracts and deterministic synthetic fixtures.

## Transaction History

Source root: `../macysth-RELEASE-26.4.x/macysth-RELEASE-26.4.x`.

| Legacy evidence                                                        | POC behavior                                                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `receiptbuilder/actions/UPCWeekAction.java` and `WeekRangeAction.java` | UPC plus inclusive date-range query; explicit `fromDate`/`toDate` browser contract and legacy `week`/`endingWeek` mapping |
| `receiptbuilder/actions/SpecialQueryAction.java`                       | Deduplicated, ordered results; one-result auto-open; explicit 250-result limit warning                                    |
| `WebContent/display_table.jsp`                                         | Transaction number, date, store, register, type and total                                                                 |
| `receiptbuilder/actions/SingleTransaction.java`                        | Division/date/store/register/transaction form a compound record identity                                                  |
| `receiptbuilder/ReceiptBuilder.java` and output classes                | Linked transaction details/history and receipt variants, rendered through a new domain component                          |

Java paths above are under `src/main/java/com/macys/macysth/` unless stated otherwise.

The adapter validates real calendar dates within the source's 2000–2099 range.
The synthetic service uses source-shaped fields such as `divNum`, `gregDate`,
`transactionDetails`, `feeTotals` and `receiptOutput`; these are a new mock HTTP
contract, not a claim that the existing app already exposes that API.

Deliberate differences:

- Query and selected-record state live in each browser application instance,
  not a shared server-side “current transaction” session.
- The unique result count drives truncation metadata so duplicates cannot make
  the UI claim that one unique record is a truncated 250-record result set.
- Receipts are invented, read-only, structured views. Existing Java HTML receipt
  formatting, every tender/coupon/tax edge case and historical timezone semantics
  have not been migrated.
- Hosted/tokenized account fields, account hashing, resend/JMS, special reports,
  pending returns and the remaining query modes are outside this slice.

## Associate Communications

Source root: `../associatecommunicationsweb-master/associatecommunicationsweb-master`.

| Legacy evidence                          | POC behavior                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `WebContent/default.jsp`                 | Direct application launch remains possible without visiting the hub                       |
| `WebContent/home/listTrainingAlerts.jsp` | Training Alerts first; metadata/FOB columns, new indicator and a 50-result cap            |
| `io/DocumentDataIO.java`                 | Division, requested store or all-store 9999, effective-date and document-type eligibility |
| `service/DocumentService.java`           | Separate list, detail and page operations                                                 |
| `servlet/actions/RetrievePDF.java`       | A page-image viewer, not an embedded original-PDF reader                                  |

Java paths above are under `src/main/java/com/macys/smartcomm/`.

Deliberate differences:

- Eligibility is checked independently for list, detail and each page. A known
  document ID is not authorization.
- A successful empty list is distinct from a dependency failure. The original
  data-access error handling can return an empty list after an SQL failure;
  the modern contract deliberately preserves the error instead.
- Fixture eligibility uses a fixed, displayed date (2026-11-14), making the demo
  and tests reproducible. It is not live production document availability.
- The legacy action returns PNG pages despite its PDF name. The POC renders
  escaped, server-generated SVG pages from plain synthetic document content.
  No user files or original business documents are used in these page images.
- Production launch identity/store context must be trusted and validated. The
  demo profile selector and default context do not implement POS identity or SSO.
- Warranties, vendor trees, external STAR links, POS printing, original-file
  downloads, administration and the remaining categories are not implemented.
- A later presentation-only follow-up adds a T1–T8-style communications menu,
  larger register-oriented controls, a Web/POS switch and simulated return-to-POS.
  Both views reuse the existing document journey and API mappings. Unimplemented
  legacy categories and barcode printing stay disabled; browser Alt+number
  shortcuts are not the real terminal's hardware key mapping.
- The T1–T8 base menu is now obtained through the typed Binder endpoint
  `/api/binder/v1/apps/associate-communications/menu`. The current Binder route
  returns reviewed synthetic items and session store context; the UI validates
  the response before creating commands. Document-specific T-key overrides remain
  presentation behavior. This is the explicit mock seam for a future approved
  Apigee/data adapter, not evidence that the legacy app already exposes this API.

## Enterprise integration remains separate

Production API and Apigee contracts are not present in these app archives.
The Spool operation registry and Binder adapters make that seam explicit.
Macy's-approved API/authentication/launch contracts and nonproduction access are
needed before claiming production integration or workflow parity.
