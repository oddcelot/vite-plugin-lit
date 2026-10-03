# Domain language

Terms the code and its reviews use with one meaning. When a name in the code
and a name here disagree, one of them is wrong.

## Pages

**Page**: one document running the Lit runtime, identified by the `pageId` it
mints at boot. A reload is a new page in the same tab (same `tabId`). Several
pages can be connected at once: tabs, frames, a StackBlitz preview.

**Followed page**: the one page whose traffic the node side accepts. The
first page to announce itself with an id becomes followed; a later `ready`
from another page takes over. Traffic from any other page is dropped. A
runtime that sends no `pageId` (an older plugin) is never filtered. Owned by
`src/lib/devframe/followed-page.ts`.

- **Reconnect**: a `ready` from the followed page itself. Its socket dropped;
  its clock did not restart, so its buffer stays.
- **Page change**: a `ready` from another page. The buffer, the cached tree
  and details, and the HMR history are forgotten, and the panel hears
  `page-changed`. It is a **reload** when the new page runs in the same tab.

_Avoid_: active page (the code's older name, still on `activePageId`),
current page.
