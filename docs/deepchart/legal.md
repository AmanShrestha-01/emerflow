# DeepChart: US / Maryland legal and regulatory brief

*Update 2026-09-19: the board hospital is **Johns Hopkins Hospital** (real, the host of this hackathon); the two outside hospitals are fictional (**Fells Point Heart Institute**, **Hampden Family Health**), as are the doctors and patients. Section 8's real-name mitigation therefore still applies to the board hospital: no logos, and the "not affiliated with, endorsed by, or connected to" line is shown in the UI.*

*Researched 2026-09-19. This is not legal advice. It is a hackathon research summary and should be checked by a health-privacy lawyer before any real deployment. Items marked **[uncertain]** are my reading of the sources, not settled answers.*

---

## 1. HIPAA

**Provider-to-provider exchange for treatment: permitted without patient authorization.** A covered entity may use or disclose PHI for its own treatment and "for treatment activities of a health care provider" (45 CFR 164.506(c)(1)–(2)). A Hopkins ER doctor asking Sinai for a shared patient's records is the textbook case. The rule *permits* disclosure but doesn't *require* it: each hospital still decides whether to answer, subject to information blocking (section 4). [eCFR 164.506](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.506)

**Minimum necessary: does not apply to treatment.** The standard excludes "disclosures to or requests by a health care provider for treatment purposes" (45 CFR 164.502(b)(2)(i)). Showing the full merged record to a treating doctor is allowed. Role-based access for *workforce* (164.514(d)(2)) still applies inside each organization, so non-treating staff roles such as a surge commander should see less. [eCFR 164.502](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.502)

**Business Associate: yes.** The company would create, receive, maintain or send PHI for hospitals, so it is a Business Associate (45 CFR 160.103). The definition names "a Health Information Organization … or other person that provides data transmission services with respect to PHI to a covered entity and that requires access on a routine basis." DeepChart stores and merges records, so the "mere conduit" exception doesn't apply. It would need:
- a BAA with every hospital (164.502(e), 164.504(e));
- subcontractor BAAs with its cloud and LLM vendors. Google Cloud/Vertex AI offers a BAA for listed services.

BAs are directly liable under the Security Rule and parts of the Privacy Rule. [eCFR 160.103](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-160/subpart-A/section-160.103), [HHS BA guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/business-associates/index.html)

**Security Rule.** The current rule (45 CFR Part 164 Subpart C) requires:
- a risk analysis;
- access controls with unique user IDs and emergency access (164.312(a));
- **audit controls** (164.312(b));
- integrity, person/entity authentication, and transmission security.

Encryption is "addressable" today. **Proposed update:** OCR published an NPRM on 2025-01-06; comments closed 2025-03-07. It would make encryption and MFA mandatory, require asset inventories and network maps, add 72-hour restore targets, and require annual pen testing. **Status as of Sept 2026: not final.** HHS moved it to the long-term agenda with a target of about July 2027, and many providers asked for withdrawal. Design to it anyway (MFA plus encryption). [Federal Register NPRM](https://www.federalregister.gov/documents/2025/01/06/2024-30983/hipaa-security-rule-to-strengthen-the-cybersecurity-of-electronic-protected-health-information), [Clark Hill: delayed to 2027](https://www.clarkhill.com/news-events/news/hipaa-security-rule-update-delayed-until-2027/), [Alston & Bird](https://www.alston.com/en/insights/publications/2025/11/hipaa-security-rule-overhaul)

**Access logs and accounting of disclosures.**
- The HIPAA accounting right (164.528) **excludes treatment disclosures**. A patient has no HIPAA right to a list of which doctors viewed their chart for treatment.
- HITECH §13405(c) would have added EHR treatment disclosures, but HHS's 2011 "access report" NPRM was **never finalized [uncertain whether it will ever be]**.
- Internal audit logs are still required by the Security Rule (164.312(b)).
- **Maryland goes further for HIEs** (section 3): HIEs must give patients a report of who accessed their data.

DeepChart's patient access log is a good feature. Under HIPAA it is voluntary; under Maryland HIE rules it is effectively required. [eCFR 164.528](https://www.ecfr.gov/current/title-45/subtitle-A/subchapter-C/part-164/subpart-E/section-164.528)

**Right of access (164.524).** Patients can get copies of their designated record set within 30 days (plus one 30-day extension), in the form and format they request if readily producible. A 2021 NPRM would shorten this to 15 days; it is **not finalized [uncertain]**. Covered entities must verify the requester's identity (164.514(h)). [HHS right-of-access guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access/index.html)

---

## 2. Special categories

- **42 CFR Part 2 (SUD records).**
  - The final rule came out 2024-02-08. **Compliance date: 2026-02-16**, and OCR began Part 2 enforcement then.
  - With one general consent, a Part 2 program's records can flow for treatment, payment and operations (TPO), and HIPAA entities that receive them can redisclose under HIPAA.
  - Records still **cannot be used in proceedings against the patient** without consent or a court order.
  - Records must be segmented/labelled.
  - For DeepChart: tag Part 2 data, keep a consent record, and don't show SUD program records from a Part 2 source without the TPO consent on file.

  [HHS fact sheet](https://www.hhs.gov/hipaa/for-professionals/regulatory-initiatives/fact-sheet-42-cfr-part-2-final-rule/), [HIPAA Journal](https://www.hipaajournal.com/february-16-2026-compliance-deadline-part-2-final-rule/)
- **Psychotherapy notes.** These need patient authorization even for treatment, except for the originating clinician's own use (164.508(a)(2)). Exclude them from merges entirely. Maryland also has stricter mental-health record rules (Health-Gen §4-307).
- **Reproductive health privacy rule (2024).** It took effect 2024-06-25 and was **vacated nationwide on 2025-06-18** in *Purl v. HHS* (N.D. Tex.). Only the Part 2-related Notice of Privacy Practices changes survived. The Fifth Circuit dismissed the appeal on 2025-09-10, so the federal rule is gone. **Maryland protections still apply:** HB 812 / SB 786 (2023, ch. 248–249) restrict HIE and provider disclosure of "legally protected health care" (abortion and gender-affirming care). MDH published the protected code list in Sept 2024, and HIEs and EHR vendors must block those codes. [Holland & Knight](https://www.hklaw.com/en/insights/publications/2025/06/hipaas-reproductive-health-rule-is-vacated-nationally), [ABA on Fifth Circuit](https://www.americanbar.org/groups/health_law/news/2025/signaling-end-purl-case/), [DLS report on HB 812](https://dlslibrary.state.md.us/publications/Exec/MDH/MHCC/SB786Ch248HB812Ch249(4)(2023)_FY2024(2).pdf)
- **HIV and genetic info.**
  - Both are ordinary PHI under HIPAA. Genetic information is explicitly PHI, and GINA bars its use for underwriting.
  - Maryland has separate HIV test confidentiality rules (Health-Gen §18-336/18-337) **[uncertain on exact current section numbers]**.
  - Maryland's 2022 PIPA amendment added genetic information to breach-notice triggers.
  - Maryland HIE regs treat these as "sensitive health information," which needs granular consent handling.

---

## 3. Maryland specifics

- **Maryland Confidentiality of Medical Records Act (Health-Gen §4-301 et seq.).** §4-305(b) allows disclosure without authorization to providers for treatment and when a provider determines disclosure is needed for a patient's **emergency** care. §4-302.2/4-302.3 add HIE-specific duties, including the legally protected health care limits. Maryland lets patients sue, so violations carry civil liability and damages (§4-309). [Justia §4-305 (2025)](https://law.justia.com/codes/maryland/health-general/title-4/subtitle-3/section-4-305/), [MGA statute text](https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=ghg&section=4-305&enactments=false)
- **CRISP** is the **State-designated HIE** (Health-Gen §19-143, designated by MHCC). All Maryland acute-care hospitals connect to it, and it already runs the Encounter Notification Service and the clinical query portal. CRISP connects to TEFCA as a Participant of the eHealth Exchange QHIN. [CRISP](https://www.crisphealth.org/), [eHealth Exchange / CRISP](https://ehealthexchange.org/ehealth-exchange-and-crisp-shared-services-announce-qhin-intentions/)
- **Must a new exchange register with MHCC?** **Likely yes.** COMAR 10.25.18 (amended 2024–2025) requires any HIE operating in Maryland to register with MHCC **annually**. MHCC reads "HIE" broadly: it includes EHR developers whose systems offer data exchange. A cross-hospital query-and-merge service fits that reading. Registered HIEs must also meet COMAR 10.25.18's privacy, security, audit and consent requirements. [MHCC HIE registration](https://mhcc.maryland.gov/healthcare-communities/health-information-technology/health-information-exchange-hie/hie-registration), [Draft final amendments, Mar 2025](https://mhcc.maryland.gov/mhcc/pages/home/meeting_schedule/documents/presentations/2025/20250320/agd6_comar_102518_drft_regs.pdf)
- **Patient opt-out and access reports (COMAR 10.25.18.03).**
  - Patients may **opt out** of an HIE at any time. Only limited categories still flow: core identifiers, lab results, prescriptions, public health reporting and legally required disclosures.
  - Opt-outs must be honored within 5 business days via the consent management application.
  - Patients can request a report listing **each authorized user, their organization, date/time and type of PHI accessed**, with two free reports a year.

  DeepChart would have to check the CRISP/state consent status before querying and honor opt-outs. [COMAR 10.25.18.03 (LII)](https://www.law.cornell.edu/regulations/maryland/COMAR-10-25-18-03)
- **Maryland Online Data Privacy Act (MODPA).** Effective 2025-10-01 and applying to processing from **2026-04-01**. It exempts **PHI handled under HIPAA** as a data-level carve-out, not an entity-level one. The clinical core of DeepChart would be exempt. Non-PHI data such as marketing site analytics or a consumer app outside a BAA would not, and MODPA's consumer-health-data rules are strict (for example, no sale of sensitive data). [Koley Jessen](https://www.koleyjessen.com/insights/publications/maryland-online-data-privacy-act), [Baker Donelson](https://www.bakerdonelson.com/marylands-new-online-data-privacy-act-sweeping-protections-for-consumer-health-data-and-implications-for-health-care-life-sciences-and-ai)

---

## 4. Interoperability, information blocking and networks

- **Information blocking** (21st Century Cures Act §4004; 45 CFR Part 171) bars "actors" (providers, certified health IT developers, and **HINs/HIEs**) from unreasonably interfering with access, exchange or use of EHI. Providers now face CMS disincentives, finalized 2024-06-24. Hospitals therefore can't arbitrarily refuse a legitimate treatment query. **Caution:** if DeepChart itself became an HIN/HIE, it would also be an actor bound by these rules.
- **HTI-5.** The proposed rule came out 2025-12-22 (FR 2025-12-29), with comments closing 2026-02-27. It is deregulatory, favors FHIR APIs, and clarifies that "access/use" includes automated means, including AI. **Not final as of Sept 2026 [uncertain on timing].** HTI-1 (2024) and HTI-2/HTI-4 remain the operative rules. [HTI-5 (ONC)](https://healthit.gov/regulations/hti-rules/hti-5-proposed-rule/), [Federal Register](https://www.federalregister.gov/documents/2025/12/29/2025-23896/health-data-technology-and-interoperability-astponc-deregulatory-actions-to-unleash-prosperity), [Covington](https://www.covingtondigitalhealth.com/2026/01/hhs-proposes-changes-to-the-health-it-certification-program-and-information-blocking-regulations-in-hti-5-proposed-rule/)
- **TEFCA.** The Common Agreement defines six Exchange Purposes, including **Treatment** and **Individual Access Services**. The Treatment XP SOP was revised in late 2025, and the IAS SOP v3.0 takes effect 2026-08-03. ONC codified TEFCA in 45 CFR Part 172 (Dec 2024). [RCE FAQs](https://rce.sequoiaproject.org/rce/faqs/), [FR TEFCA rule](https://www.federalregister.gov/documents/2024/12/16/2024-29163/health-data-technology-and-interoperability-trusted-exchange-framework-and-common-agreement-tefca)
- **Could DeepChart get data in practice? Yes, but only through an existing on-ramp, not by scraping or ad-hoc hospital connections:**
  1. **Best path in Maryland:** sell to hospitals as a **front-end over CRISP**, as a CRISP-approved app/partner. CRISP's clinical query already returns cross-hospital records, and CRISP handles consent and opt-outs.
  2. Become a **TEFCA Subparticipant** under a QHIN (eHealth Exchange, Epic Nexus, CommonWell, etc.) for the Treatment XP. That brings TEFCA flow-down terms and security requirements.
  3. Use **Carequality/CommonWell** through an existing implementer; Epic Care Everywhere already does this.
  4. Use each hospital's certified **FHIR (US Core) APIs**. This needs a contract with every hospital and works best as a SMART-on-FHIR app launched inside the hospital EHR.

  **Reality check:** the treatment side of this problem is largely served by Care Everywhere and CRISP today. DeepChart's differentiator is the **disagreement check across sources**, which could ship as an app on top of those feeds.

---

## 5. FDA: is it a device?

Three statutory exclusions under FD&C Act §520(o)(1) are relevant:
- **(A) administrative support** of a health care facility. This covers the surge board's bed and flow logic.
- **(C) electronic patient records** that "transfer, store, convert formats, or display the equivalent of a paper medical chart," as long as the software is **not** intended to interpret or analyze records for diagnosis or treatment.
- **(E) non-device CDS.**

**The January 6, 2026 revised CDS guidance** supersedes the 2022 version. It adds enforcement discretion for single-output CDS where only one option is clinically appropriate and stresses transparency. It moved the **time-critical** concern into Criterion 4, and FDA's approach to time-critical CDS is unchanged. [FDA CDS guidance PDF](https://www.fda.gov/media/109618/download), [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance), [Arnold & Porter](https://www.arnoldporter.com/en/perspectives/advisories/2026/01/fda-cuts-red-tape-on-clinical-decision-support-software)

**The four CDS criteria applied to DeepChart:**

| # | Criterion | DeepChart |
|---|---|---|
| 1 | Doesn't acquire, process or analyze medical images or signals | **Meets.** Structured record fields only. |
| 2 | Displays or analyzes medical information | **Meets.** |
| 3 | Supports or provides recommendations to an HCP (doesn't replace judgment or direct treatment) | **Likely meets, or isn't reached.** It shows sources side by side, flags "sources disagree; a human must resolve," never picks a value and never gives instructions. A factual discrepancy flag arguably isn't a clinical recommendation at all. |
| 4 | HCP can independently review the basis | **Meets well.** Every source, value and timestamp is shown. **Risk:** ER use is time-critical, and FDA watches for CDS that clinicians rely on without review in urgent settings. |

**Position [uncertain; not FDA-confirmed]:** DeepChart is most defensibly **non-device software under §520(o)(1)(C) and (A)**, with (E) as a backstop. Risk rises if it ever:
- ranks which source is "right";
- auto-suggests a dose or other clinical action;
- blocks an order on a clinical rather than record-consistency basis;
- adds AI inference that fills in missing facts.

Keep the "never says which is correct" rule. Write an intended-use statement that says exactly this.

---

## 6. Identity matching, breaches and the FTC rule

- **Patient matching risk.** Mismatches can merge another person's allergy or anticoagulant status into a chart, or miss a real record. The main liability is negligence and product liability for the vendor, plus malpractice exposure for clinicians and hospitals. The Joint Commission requires two identifiers (NPSG.01.01.01). ONC has long flagged matching as a safety issue, and there is no national patient ID. DeepChart's manual confirmation, required demographic fields, and display of *which* identifiers matched are good mitigations. Also:
  - log who confirmed each match;
  - allow un-merge;
  - never auto-merge on name + DOB alone;
  - disclaim warranties in contracts and carry E&O/cyber insurance.
- **Maryland PIPA (Com. Law §14-3504).** As amended in 2022 (HB 962, effective 2022-10-01):
  - notify affected Marylanders within **45 days of discovery**;
  - a vendor holding data for someone else must notify the owner within **10 days**;
  - "health information" and genetic information count as personal information.

  HIPAA-compliant entities are generally deemed compliant with PIPA's notification rules, but must still notify the Maryland AG **[uncertain: check the deemed-compliance wording]**. [MGA §14-3504](https://mgaleg.maryland.gov/mgawebsite/laws/StatuteText?article=gcl&section=14-3504&enactments=False&archived=False), [MD AG guidance](https://oag.maryland.gov/i-need-to/Pages/Guidelines-for-Businesses-to-Comply-with-the-Maryland-Personal-Information-Protection-Act.aspx)
- **HIPAA Breach Notification Rule (164.400–414).** This applies as a BA: notify the covered entity without unreasonable delay and within 60 days.
- **FTC Health Breach Notification Rule** (16 CFR Part 318, amended effective 2024-07-29). It **does not apply** to HIPAA covered entities or BAs acting as such. It *would* apply if DeepChart ran a consumer-facing personal health record or app outside a BAA, such as a standalone patient app pulling records. [FTC compliance guide](https://www.ftc.gov/business-guidance/resources/complying-ftcs-health-breach-notification-rule-0), [Federal Register](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)

---

## 7. The patient link (token in URL)

- **Risks:**
  - URLs leak through browser history, server/proxy/CDN logs, `Referer` headers to third-party resources, link-preview bots in SMS/email apps, forwarding and screenshots.
  - Anyone holding the link is treated as the patient, which conflicts with HIPAA's **identity verification** duty (164.514(h)).
  - The current page shows no clinical values, but it does show *which providers viewed the record*, and that is itself PHI: it reveals that the person was a patient.
- **Rules:**
  - OCR's access guidance lets a covered entity send PHI by **unencrypted** channels (email, text) **if the individual asks and is warned of the risk**. That supports sending a link at the patient's request.
  - Delivery doesn't remove the verification or Security Rule duties.
  - The access log is not part of the designated record set under HIPAA, but Maryland HIE rules require giving patients an access report (section 3).
- **Mitigations:**
  - long random token (128 bits or more) that is short-lived, revocable and single-purpose;
  - swap the token for a session cookie on first open, then strip it from the URL;
  - a second factor such as DOB or an SMS code before showing the log;
  - `Referrer-Policy: no-referrer`, no third-party scripts or analytics on the page, and `noindex`;
  - rate limiting;
  - log every view of the link itself.

  [OWASP: sensitive data in query strings](https://owasp.org/www-community/vulnerabilities/Information_exposure_through_query_strings_in_url), [HHS access guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/access/index.html)

---

## 8. The hackathon demo itself

- **Synthetic data only: no HIPAA issue.** HIPAA governs covered entities and BAs handling real individuals' PHI. A student team showing invented patients handles no PHI. To keep it that way:
  - don't use real patients' names, or names plus DOBs that could match real people;
  - don't load any real exports, even "de-identified" ones;
  - keep the "all data is synthetic" label on screen;
  - public CMS hospital data (Care Compare) is fine to use.
- **Real hospital names (Johns Hopkins, Sinai, MedStar).** Naming a real hospital to describe it is generally allowed (**nominative fair use**). The risk is **false endorsement / implied affiliation** under the Lanham Act §43(a) (15 U.S.C. §1125(a)). That risk is higher when a demo shows logos, uses brand colors, or shows the hospitals as "integrated" partners. Johns Hopkins also has its own name-use policy, and this event is at Hopkins. Risk is low for a non-commercial hackathon demo, but not zero if it's later pitched to investors. [15 U.S.C. §1125](https://www.law.cornell.edu/uscode/text/15/1125)
  - **Simple mitigation:**
    - no logos;
    - a visible footer reading: *"Demo with synthetic data. Hospital names are used for illustration only; EmerFlow/DeepChart is not affiliated with, endorsed by, or connected to these institutions."*
    - the stronger option is fictional names such as "Harbor General" and "Northside Medical" for any public or recorded version.

---

## Can we build this?

- **Hackathon demo: yes.** Synthetic data, no real connections, a disclaimer on hospital names. There's no regulatory blocker.
- **Real product: legally possible, commercially gated.** Treatment exchange is expressly allowed under HIPAA and Maryland law. The hard parts are:
  - getting access through CRISP, TEFCA or EHR APIs rather than raw hospital connections;
  - MHCC registration as an HIE if it operates as one;
  - consent and sensitive-data handling (Part 2, Maryland protected care, opt-outs);
  - a disciplined non-device FDA position.

## What a real deployment would need

1. **BAAs** with each hospital, and subcontractor BAAs with the cloud and LLM vendor (for example Google Cloud's HIPAA BAA scope).
2. **A data route:** a CRISP partnership or app, a TEFCA Subparticipant role (Treatment XP), or Carequality/CommonWell through an implementer, or per-hospital SMART-on-FHIR contracts.
3. **MHCC HIE registration** (COMAR 10.25.18) if acting as an exchange, plus annual renewal, audits and consumer access reports.
4. **Consent engine:**
   - honor CRISP/HIE opt-outs within 5 business days;
   - Part 2 consent tags and segmentation;
   - block Maryland "legally protected health care" codes;
   - exclude psychotherapy notes;
   - granular consent for sensitive data.
5. **Security:**
   - HIPAA risk analysis;
   - MFA, encryption at rest and in transit;
   - immutable audit logs;
   - break-the-glass review workflow;
   - pen testing;
   - incident response meeting HIPAA's 60-day and PIPA's 45-day/10-day clocks.

   Build to the proposed Security Rule now.
6. **FDA position memo:** an intended-use statement under §520(o)(1)(C)/(A)/(E), a "never recommends" design control, and change control so later features don't cross into device territory.
7. **Identity matching governance:** match thresholds, human confirmation, un-merge and error reporting; E&O and cyber insurance.
8. **Patient link hardening** (section 7) and identity verification.
9. **Contracts:** warranty and liability limits, and a clinician-responsibility statement.

## Safe sentences for judges

1. "Everything you see runs on synthetic patients we generated. No real health data was used, and the hospital names are illustrative with no affiliation implied."
2. "HIPAA already allows providers to share records with each other for treatment without a separate patient authorization. DeepChart is about showing those records side by side, not about getting around consent."
3. "DeepChart never decides which record is right and never gives clinical advice. It flags that sources disagree and a clinician resolves it, which is how we'd keep it outside FDA device regulation."
4. "In a real deployment we'd plug into Maryland's state HIE, CRISP, or TEFCA, sign business associate agreements, and honor patient opt-outs and special protections for substance-use and reproductive care records."
5. "Every outside-record view needs a stated reason and is logged, and patients can see who looked at their record. That's the same kind of access report Maryland already requires of health information exchanges."
