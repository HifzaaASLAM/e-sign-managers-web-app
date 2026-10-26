# ShareHouseManagers — Emails by Module

All emails in this application are **outbound only**, sent through **Resend**. The app does not receive/process any inbound email. Footer contact `info@sharehousemanagers.com.au` is display text only, not an in-app inbox.

- **From address:** `EMAIL_FROM` / `EMAIL_FROM_NAME` (default sender name: `ShareHouseManagers`)
- **Provider:** Resend (`RESEND_API_KEY`)
- Placeholders below: `{DocumentType}`, `{docId}`, `{applicant}` are filled at send time.

---

## Shared emails (used across multiple modules)

| When | To | Subject |
|---|---|---|
| Document created / sent for signing | Recipient | `Action Required: Please Sign Your {DocumentType}` |
| Signing email delivered (acknowledgment) | Creator / Admin | `Signing email sent — {DocumentType} ({docId})` |
| Recipient signs | Creator / Admin | `{DocumentType} Signed - {docId}` |
| Final signed file uploaded to Drive | Creator / Admin | `Signed Document Ready - {docId}` |
| OTP verification (when used) | User | `Your verification code for {DocumentType}` |

---

## 1. Tenant Application

| When | To | Subject |
|---|---|---|
| Application link sent | Applicant | `Your Tenant Application — ShareHouseManagers` |
| Signing email sent (ack) | Creator | `Signing email sent — Tenant Application (...)` |
| Application issued (if landlord linked) | Landlord | `Tenant Application sent for review — {applicant}` |
| Applicant signs | Creator | `Tenant Application signed — {applicant}` |
| Ready for landlord review | Landlord | `Action required: Review & approve tenant — {applicant}` |
| Landlord approves | Creator | `Landlord approved tenant — {applicant} ({docId})` |
| Landlord approves / auto-approve | Applicant | `Your Tenant Application has been approved` |

---

## 2. Tenant Agreement

| When | To | Subject |
|---|---|---|
| Creator signs & sends | Tenant | `Action Required: Please Sign Your Tenant Agreement` (Word `.docx` attachment + signing link) |
| Signing email sent (ack) | Creator | `Signing email sent — Tenant Agreement (...)` |
| Tenant signs | Creator | `Tenant Agreement Signed - {docId}` |
| Final file ready (Drive callback) | Creator | `Signed Document Ready - {docId}` |

---

## 3. Property Management Agreement

| When | To | Subject |
|---|---|---|
| Sent for signing | Owner / Signer | `Action Required: Please Sign Your Property Management Agreement` |
| Signing email sent (ack) | Creator | `Signing email sent — Property Management Agreement (...)` |
| Signer completes | Creator | `Property Management Agreement Signed - {docId}` |

---

## 4. Ownership Statement

| When | To | Subject |
|---|---|---|
| Admin sends completed statement | Owner | `Your Ownership Statement is ready` (attachment; no signature required) |

---

## 5. PM Takeover Form

| When | To | Subject |
|---|---|---|
| Sent for signing | Signer | `Action Required: Please Sign Your PM Takeover Form` |
| Signing email sent (ack) | Creator | `Signing email sent — PM Takeover Form (...)` |
| Signer submits | Creator | `PM Takeover Form Signed - {docId}` |
| Final file on Drive | Creator | `Signed Document Ready - {docId}` |

---

## 6. Rental Reference Form

| When | To | Subject |
|---|---|---|
| Sent for signing | Referee | `Action Required: Please Sign Your Rental Reference Form` |
| Signing email sent (ack) | Creator | `Signing email sent — Rental Reference Form (...)` |
| Referee submits | Creator | `Rental Reference Form Signed - {docId}` |
| Final file on Drive | Creator | `Signed Document Ready - {docId}` |

---

## Email functions (source reference)

All defined in `lib/shm/mailer.ts`:

- `sendSigningEmail` — signing link to recipient (+ triggers ack to creator)
- `sendSigningEmailSentAcknowledgment` — ack to creator
- `sendTenantApplicationSignedNotification` — applicant signed → creator
- `sendTenantAgreementTenantSignedNotificationEmail` — tenant signed TA → `info@sharehousemanagers.com.au` (override `TA_TENANT_SIGNED_NOTIFY_EMAIL`) with signed agreement attachment
- `sendTenantApplicationApprovedEmail` — approval → applicant
- `sendLandlordApplicationSentNotice` — application issued → landlord
- `sendLandlordReviewInviteEmail` — review & approve → landlord
- `sendLandlordApprovalNotifications` — landlord approved → creator + applicant
- `sendOwnershipStatementToOwnerEmail` — statement → owner
- `sendAdminRecipientSignedEmail` — recipient signed → admin/creator
- `sendAdminFinalFileReadyEmail` — final file ready → admin/creator
- `sendOtpEmail` — OTP verification code
- `sendAdminNotificationEmail` — internal helper for admin notifications
