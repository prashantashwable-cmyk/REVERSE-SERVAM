# Marathi glossary (interface terms)

The Marathi interface text lives in `packages/domain/src/messages/mr.ts`. Use these terms everywhere, so the same thing is always called the same name. Familiar loan words that people in Maharashtra already use at work (लीड, साइट, लिफ्ट, OTP) are kept on purpose.

| English | मराठी | Note |
|---|---|---|
| Lead | लीड | feminine: "लीड तयार झाली" |
| Survey / Surveyor | सर्वेक्षण / सर्वेक्षक | |
| Site | साइट | |
| Lift / Elevator | लिफ्ट / एलिव्हेटर | brand name: AIEC एलिव्हेटर OS |
| Owner (business owner role) | मालक | |
| Lead owner (responsible sales person) | जबाबदार विक्री अधिकारी / जबाबदार व्यक्ती | not मालक |
| Sales Executive | विक्री अधिकारी | |
| Technical Manager | तांत्रिक व्यवस्थापक | |
| Partner company | भागीदार कंपनी | |
| Assign / Reassign | नेमून द्या / पुन्हा नेमून द्या | |
| Qualify / Qualified | पात्र ठरवा / पात्र | |
| Lost / Invalid / Won | गमावली / अवैध / मिळाली | |
| Follow-up / overdue | पाठपुरावा / थकलेले | |
| Score | गुण | |
| Duplicate | डुप्लिकेट | |
| Evidence | पुरावा | |
| Measurement | मोजमाप | units stay mm / cm / m |
| Check-in | चेक-इन | |
| Technical review | तांत्रिक पुनरावलोकन | |
| Revision (version) / Return for revision | आवृत्ती / सुधारणेसाठी परत पाठवा | |
| Reschedule / Revisit | वेळ बदलणे / पुन्हा भेट | |
| Site inaccessible | साइट पोहोचण्याजोगी नाही | |
| Sync / Offline | सिंक / ऑफलाइन | |
| Audit log | ऑडिट लॉग | |
| Notification | सूचना | |
| Permission / Role | परवानगी / भूमिका | |
| Quotation | कोटेशन | |
| Submit / Save / Cancel | सादर करा / जतन करा / रद्द करा | |

## Rules

- **Not translated:**
  - names, projects, addresses, notes and anything else a person typed
  - business IDs (LD-PUN-2026-00025)
  - phone numbers and units
  - the brand AIEC
- **Numbers:** digits stay 0–9.
- **Dates:** Marathi month names and day parts (सकाळ / दुपार / संध्याकाळ / रात्र).
- **Placeholders:** every `{placeholder}` in English must appear in the Marathi text. A unit test checks this.
- **Language switch:** "English" is written in English, as the name of the language.
- **Review:** have a native-speaker business user review new strings before production.
