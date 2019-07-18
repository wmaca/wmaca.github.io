---
title: Managed storage for the browser
date: "2019-07-18T17:12:03.284Z"
description: Discussing the current state of storage on the web and how to implement a proper managed storage solution.
---

As an in-depth explanation of a managed storage solution may not be of interest to a broader audience, an analysis of the current available storage mechanisms, their limitations and how to use them for this purpose may be of greater value.

This writing will not go into the details of how to code a managed storage solution for the browser, nor try to exhaust such a broad theme. Consider this a dump of the thinking process and research behind the construction of such solution.

In the end of this reading, you are expected to have a better understating of what the browser can and can’t do when it comes to storage, and to know how careful you need to be when dealing with this.

## Available browser APIs

Currently, browsers offer a few storage mechanisms, each with a different purpose:

- Cookies
- Web Storage API (`localStorage` and `sessionStorage`)
- Application Cache
- IndexedDB
- File API and File and Directory Entries API
- Cache API

Some of them have their usage deprecated (e.g. Application Cache), others have serious constraints, like reduced size limit and data type (e.g. Web Storage API, Cookies), which would make them unusable for a more complex storage management solution. File API, and File and Directory Entries API are not a standard yet.

For those not familiar with **IndexedDB** , it “[is a low-level API for client-side storage of significant amounts of structured data, including files/blobs](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)”. The interesting part is that it has indexes, allowing performant searches in the data stored. It's API is event based, and it takes some time to get familiarised with it.

The **Cache API** is part of the Service Workers specification, but there is no need for them to be used together. It is basically a `Request` / `Response` storage, where you can create different caches for different purposes (e.g. a cache for offline assets and another for content-related images). It has a Promise based API .

Both are accessible from window, service workers and web workers, making them more versatile for a proper storage solution. For example, requests can be intercepted at the service workers and stored, and heavy activities, such as cleaning expired stored items, can be offloaded to a web worker.

**IndexedDB** and **Cache API** are the few left options, and, as explained later, will both be used for different parts of the managed store solution.

## Purpose of the each API

As **Cache API** is `Request`/`Response` based, it is natural to choose it as the mechanism to store assets, like images, JS/CSS files and templates. It is tempting to extend this rationale and consider using this API to store raw responses from external services consumed by the application.

Nevertheless, those responses, in general, are only valuable after being parsed, which can expensive to perform on every access to the data. In addition, most of the times, only small parts of the responses are relevant. Not to say that a `Response` instance would also contain headers and other information, which are likely to become useless for the application after its parse.

For **IndexedDB** is left the other range of data, which, as explained before, is not suitable to be stored as a `Response`. It can be used not only to the data itself, but also to keep record of metadata, necessary to the management of storage. As will be shown later, when under pressure, it is necessary to know **what** to delete, and to know **where** it is actually stored.

## Requirements

While different use cases may appear when exercising a way to properly manage stored information, the following requirements presented themselves as the already-hard-to-meet minimum set of requirements.

### Priority

A stored item may be defined as **persistent**. In this case, there is no situation where it can be removed from the storage. All other items are called **best-effort**, which means that they will reside in the storage as long as possible.

### Expiration

Information that is outdated must expire. It can no longer live in the storage, as it is deemed invalid, making its usage harmful to the proper functioning of an application.

### Pressure

Storage is a finite resource, therefore it is necessary to know how much is being consumed, and how much is still available. When a certain limit is reached, the storage manager must act upon it, and free the space to ensure things will keep working.

### ACID

Borrowing this acronym from database systems, and probably oversimplifying it, our storage operations must:

- be either complete or incomplete (**atomicity**), there is no middle ground;
- take the storage management from one to another valid state (**consistency**);
- allow usage from simultaneous clients without any unknown risks (**isolation**); and
- be persistent, once completed, surviving to crashes and unexpected problems (**durability**).

### Versioning

An information or an asset is generally only valid to a specific point in time, which can be translated to a version of an application. When the application version changes, the store content may become useless.

## Requirements versus Reality

Requirements always look nice in paper, but reality may be shocking. Sometimes, it is not about the will, but the tools available to have a job done. As discussed earlier, **Cache API** and **IndexedDB** are the tools available, and their limitation must be taken into account.

### Priority, but only if the user wants to.

Browsers allow the data to be stored in two different modes: **best-effort** and **persistent**.

With **best-effort** mode, data will be removed automatically whenever the browser judges necessary, and without requesting any action from the user. There is no guarantee that stored information won’t be removed by the browser.

With **persistent** mode, the user must directly instruct the browser to remove the data. Under storage pressure scenarios (i.e. browser running out of space for the application), the user must manually take action to free storage, given an alert from the browser. It is needlessly to say that the application itself can also delete the stored content. When an application relies on this type of storage, it must be taken into consideration by the application developers that the user may delete the stored information accidentally, and there is no way the application can warn or interfere during this process.

Persistent storage creates the need of an API not only to check if it is permitted, but also to request permission for persistent storage to the user:

```javascript
const isPersistent = await navigator.store.persisted()
if (!isPersistent) {
  // actually prompt the user for persistence with the browser UI
  const persistenceAllowed = await navigator.store.persist()
  if (!persistenceAllowed) {
    // warn the user about potential reduced functionalities
  }
}
```

The code above ~may not be the optimal user experience~, as it may result in an unannounced browser prompt, which may lead to user confusion. Application developers should act exactly as `persist()` does, checking if the `"persistent-storage"` permission is `"granted"` — using `navigator.permissions.query()`. This way the user can receive prior clarification about the request for persistent storage that is about to happen.

The browser may decide to grant an application the right to persist storage without directly asking the user for it. Or it may not even prompt the user to ask for persistent storage when instructed to (.e.g. opaque origin, or already knows the current permission state). For the former, each browser seems to have its own criteria, so do not wonder if `isPersistent` being `true` on the first run of this snippet.

As probably already noticed, given the API presented, persistence is not fine-grained. Either everything is persistent, or nothing is. But what is ~everything~? For site storage, which includes Cache API and IndexedDB, ~each origin~ has ~one~ site storage unit. ~Each of these units contains a single bucket~. And the explained-above persistence mode ~is applied to the whole bucket~.

To make things worse, buckets are atomic units. When deleted, they must be deleted in its entirety. For a **best-effort** bucket under storage pressure, this means loosing all stored information, and not only the necessary bits.

If bucket modes could be applied in a more fine-grained fashion, a storage management solution would take advantage of those built-in capabilities. As this is not the case, **persistent** mode is the only viable option for a storage manager, as leaving it to best-effort would possibly lead to an unexpected loss of all data.

### Pressure: I will let you know if you ask me

As, by choosing **persistent** mode, there is no built-in eviction in place, a storage management solution must be responsible to control the usage of free space. Fortunately, browsers provide `navigator.storage.estimate()`, which allows an application to retrieve the number of ~bytes~ available to (`quota`) and used by (`usage`) an origin’s site storage unit.

```javascript
const { quota, usage } = await navigator.storage.estimate()
```

Browsers are encouraged to provide a conservative estimation of the quota, as a manner to prevent unexpectedly hitting the real limit. Not only this, this value for each origin may be based on its popularity (e..g bookmarked application).

It is important to note that those values are not precise. Not only to avoid its usage as a way to fingerprint devices, but also because browsers may optimise how information is stored — as explained below.

With this estimation, storage usage can be actively monitored to detect when an application is running out of free space. Upon detection, eviction must kick in. The heuristic chosen to evict data can have any desired level of complexity, and must be done in accordance to the reality of the application and targeted devices.

If the eviction heuristic needs the size of each item individually, it is worth remembering that IndexedDB and Cache API do not provide any API for this. Nevertheless, it is possible to create a pessimistic estimation function, and test it agains the data normally used by the application. Being optimistic may lead to undetected pressure situations, and being too pessimistic may lead to frequent false-positive pressure.

Estimating the size of data may be tricky, as storage mechanisms have their own techniques to persist things, which may include metadata. A good example of this is [how IndexedDB serializes its data with its structured clone algorithm](https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializeinternal). Not only this, but optimizations, such as deduplication and compression, may make it impractical to properly guess the size occupied by the data.

### Expiration: “exp... what?”

Until this point, the eviction policy has been presented as a form to protect an application from using the storage beyond its space capacity. Nevertheless, there are other use cases which would add value to a managed storage solution.

When storing an item, it would be interesting to be able to set an expiration date, removing the item automatically when it is reached. This could be leveraged, for example, when using the storage solution for caching purposes. However, **IndexedDB** and **Cache API** do not provide an API for that. Even when a `Response` has headers defining an expiration, such as `Cache-Control`, **Cache API** does not take it into consideration.

To overcome this limitation, a managed storage solution would be required to not only track the expiration date for each item, but also to actively check for and remove expired items. As those two last tasks needs to be periodically performed, an item living in the storage may actually be already expired, but it was not removed because the cleanup did not to have a change to run yet. Ensuring this does not happen requires an expiration check to be performed during the retrieval of an item.

### ACID

As the solution will need to keep metadata about each item in the storage, when issuing an operation for an asset, not only the **Cache API** operation will need to be done, but also one at **IndexedDB** for the metadata. If both steps fail or both succeed, consistency won’t be affected. If only the storage itself fails, metadata about an inexistent item may be created. If only the metadata storage fails, a stored item may become invisible to the managed storage solution.

Regarding those two last cases, the later presents more harm than the former, as it would cause unsupervised usage of storage, which would eventually exhaust. The former can be easily resolved: as the item is being tracked, it can be removed when under pressure or when expired. This, however, may impact the proper function of the application, as it will see an item allegedly using space that could be used for other purpose, while it actually is not.

Both of the chosen browser APIs do not provide a mechanism that allows to revert the failing step. Thus it is a responsibility of the managed storage solution to ensure that the side effects of an eventual failure are under control.

As having an item without metadata has more serious implications, the order of operations — storing metadata before actually storing the item — may be enough to sufficiently overcome the lack of consistency guarantee. In case the metadata operation is successful, but it fails to store the item itself, the inconsistency created can be eventually addressed, and its impact may be acceptable for the application. This approach presents as a simpler alternative to actually implementing a consistency mechanism.

Despite IndexedDB having transactions, it has an auto-commit behaviour, which does not allow async operations that are not related to the transaction to happen during it. One could argue that, as **IndexedDB** can store blobs, using it instead of **Cache API** to store assets would resolve this issue. This is a valid approach, which has not been experimented during the writing of this.

Other problem that arises from having those two interconnected steps is the lack of isolation. During the execution of an operation, while it is incomplete, a different operation may see it partially applied, as it has more than one step. Fortunately, a [web lock](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) can be request to only allow one operation to happen at any given time. Defining what is to be “locked” and when is crucial, as unnecessary locks may hit performance. More complex solutions were not explored by the time of this writing.

Again, using **IndexedDB** to store assets — instead of **Cache API** — is a possible solution for the lack of isolation, as its transaction mechanism would offer such guarantee.

### Versioning

**Cache API** does not have a versioning mechanism, but **IndexedDB** does. For the later, when opening a database, a version number can be passed as an argument. In case there is a version upgrade — as a downgrade cannot happen — it allows the developer to access the current values stored to properly migrate them to a format compatible with the new version.

Again, not using **Cache API** for assets appears as an option. Regardless of which storage is used, deciding how to handle a version upgrade — additions, removals and migrations — may still be cumbersome.

In case the managed storage solution offers user-defined units of storage (not to be confused with the earlier presented concept of unit), a version can be associated to each of them. During a version upgrade, emptying the unit may be simplest approach to proper handle versioning.

With the possibility of multiple windows running different versions ~of the application~, it is important to note that different versions ~of the storage~ may be accessed at the same time. Such a managed storage solution should handle this case, as it may lead to unexpected behaviour of the application.

## Conclusion

As seen, despite providing valuable functionalities to applications in general, the currently available storage APIs still don’t suffice for the use case presented. Lack of control over each item expiration and a global eviction policy impose challenges to more complex applications. Features like IndexedDB’s auto-commit, while may benefit other more frequent use cases, create serious limitations. Not only this, but the overlap of functionalities, as IndexedDB’s capacity to also store assets, may cause confusion.

This is intrinsically related to how web development has been evolving over the last years. Its usage went from simple websites, with limited interaction, to complete applications running in the most diverse types of devices. New use cases arise every day, creating problems that the current solutions cannot properly address. This leaves the community — those creating and evolving the standards — with the challenge to balance all the forces in play — keep old things working and embrace the new reality.

Hopefully, this writing was able to provide an overview of the current state of storage on the web, as well as how to implement a proper managed storage solution.
