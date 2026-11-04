# vibecheck

A browser extension that lets a user restyle any website by describing the change to an AI model.

## Language

**Site Style**:
The accumulated design changes for one website origin — CSS plus a Page Script — applied every time the user visits it.
_Avoid_: Theme, skin, customization

**Revision**:
One version of a Site Style — its CSS and Page Script — produced by a single prompt or an import.
_Avoid_: Edit, change, step

**Page Script**:
The JavaScript part of a Site Style, run on every page of the site to make changes CSS cannot, such as moving or rewriting elements.
_Avoid_: User script, DOM operation, patch, JS

**Restyle Request**:
A user prompt together with a Page Snapshot, the current Site Style and any Reference Images, sent to an AI model.
_Avoid_: Job, query

**Reference Image**:
An image the user attaches to a prompt to show the look they want.
_Avoid_: Attachment, upload, inspiration

**Preview**:
A draft stylesheet the model shows on the page for a moment, to check its work from a screenshot before submitting.
_Avoid_: Draft, test run

**Page Snapshot**:
What the AI model sees of the page: a simplified structure of the document plus a screenshot of the visible area.
_Avoid_: Page context, dump

## Providers

**Provider**:
A service that runs the AI model, such as Anthropic, OpenAI or any OpenAI-compatible service.
_Avoid_: Backend, vendor, AI

**Connection**:
The way the user is authorized with a Provider: an API key or a ChatGPT subscription sign-in. One Provider can have several Connections.
_Avoid_: Account, credentials, login
