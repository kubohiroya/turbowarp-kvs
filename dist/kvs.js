// Name: KVS
// ID: kubohiroyakvs
// Description: A portable namespace and key value store for TurboWarp.
// By: Hiroya Kubo
// License: MPL-2.0

(function (Scratch) {
  'use strict';

  //#region src/config.ts
  var extensionConfig = {
  	id: "kubohiroyakvs",
  	slug: "kvs",
  	name: "KVS",
  	description: "A portable namespace and key value store for TurboWarp.",
  	author: "Hiroya Kubo",
  	license: "MPL-2.0",
  	unsandboxed: true,
  	docsURI: "https://kubohiroya.github.io/turbowarp-kvs/",
  	blockIconURI: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PHJlY3QgeD0iNCIgeT0iOCIgd2lkdGg9IjE4IiBoZWlnaHQ9IjE0IiByeD0iMyIgZmlsbD0iIzRDOTdGRiIvPjxyZWN0IHg9IjI2IiB5PSI4IiB3aWR0aD0iMTgiIGhlaWdodD0iMTQiIHJ4PSIzIiBmaWxsPSIjNTlDMDU5Ii8+PHJlY3QgeD0iMTUiIHk9IjI2IiB3aWR0aD0iMTgiIGhlaWdodD0iMTQiIHJ4PSIzIiBmaWxsPSIjRkZBQjE5Ii8+PC9zdmc+"
  };
  var block_definitions_default = {
  	extensionName: "KVS",
  	blocks: [
  		{
  			"opcode": "setValue",
  			"blockType": "COMMAND",
  			"text": "set [KEY] in [NAMESPACE] to [VALUE]",
  			"description": "Stores a text value under a namespace and key.",
  			"arguments": {
  				"NAMESPACE": {
  					"type": "STRING",
  					"defaultValue": "app"
  				},
  				"KEY": {
  					"type": "STRING",
  					"defaultValue": "message"
  				},
  				"VALUE": {
  					"type": "STRING",
  					"defaultValue": "hello"
  				}
  			}
  		},
  		{
  			"opcode": "getValue",
  			"blockType": "REPORTER",
  			"text": "value of [KEY] in [NAMESPACE]",
  			"description": "Returns a stored text value, or an empty string when absent.",
  			"arguments": {
  				"NAMESPACE": {
  					"type": "STRING",
  					"defaultValue": "app"
  				},
  				"KEY": {
  					"type": "STRING",
  					"defaultValue": "message"
  				}
  			}
  		},
  		{
  			"opcode": "hasKey",
  			"blockType": "BOOLEAN",
  			"text": "[KEY] exists in [NAMESPACE]",
  			"description": "Reports whether a key exists.",
  			"arguments": {
  				"NAMESPACE": {
  					"type": "STRING",
  					"defaultValue": "app"
  				},
  				"KEY": {
  					"type": "STRING",
  					"defaultValue": "message"
  				}
  			}
  		},
  		{
  			"opcode": "deleteKey",
  			"blockType": "COMMAND",
  			"text": "delete [KEY] from [NAMESPACE]",
  			"description": "Deletes a key if it exists.",
  			"arguments": {
  				"NAMESPACE": {
  					"type": "STRING",
  					"defaultValue": "app"
  				},
  				"KEY": {
  					"type": "STRING",
  					"defaultValue": "message"
  				}
  			}
  		},
  		{
  			"opcode": "listKeys",
  			"blockType": "REPORTER",
  			"text": "keys in [NAMESPACE] as JSON",
  			"description": "Returns a sorted JSON array of keys.",
  			"arguments": { "NAMESPACE": {
  				"type": "STRING",
  				"defaultValue": "app"
  			} }
  		}
  	]
  };
  //#endregion
  //#region \0@oxc-project+runtime@0.148.0/helpers/esm/typeof.js
  function _typeof(o) {
  	"@babel/helpers - typeof";
  	return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
  		return typeof o;
  	} : function(o) {
  		return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  	}, _typeof(o);
  }
  //#endregion
  //#region \0@oxc-project+runtime@0.148.0/helpers/esm/toPrimitive.js
  function toPrimitive(t, r) {
  	if ("object" != _typeof(t) || !t) return t;
  	var e = t[Symbol.toPrimitive];
  	if (void 0 !== e) {
  		var i = e.call(t, r || "default");
  		if ("object" != _typeof(i)) return i;
  		throw new TypeError("@@toPrimitive must return a primitive value.");
  	}
  	return ("string" === r ? String : Number)(t);
  }
  //#endregion
  //#region \0@oxc-project+runtime@0.148.0/helpers/esm/toPropertyKey.js
  function toPropertyKey(t) {
  	var i = toPrimitive(t, "string");
  	return "symbol" == _typeof(i) ? i : i + "";
  }
  //#endregion
  //#region \0@oxc-project+runtime@0.148.0/helpers/esm/defineProperty.js
  function _defineProperty(e, r, t) {
  	return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
  		value: t,
  		enumerable: !0,
  		configurable: !0,
  		writable: !0
  	}) : e[r] = t, e;
  }
  //#endregion
  //#region src/kvs-store.ts
  var DATABASE_NAME = "tw-kvs-values-v1";
  var STORE_NAME = "values";
  var KvsError = class extends Error {
  	constructor(code, message, cause) {
  		super(`[KVS][${code}] ${message}`, cause === void 0 ? void 0 : { cause });
  		_defineProperty(this, "code", void 0);
  		this.name = "KvsError";
  		this.code = code;
  	}
  };
  var IndexedDbKvsStore = class {
  	constructor(factory = indexedDB, databaseName = DATABASE_NAME, now = Date.now) {
  		_defineProperty(this, "factory", void 0);
  		_defineProperty(this, "databaseName", void 0);
  		_defineProperty(this, "now", void 0);
  		_defineProperty(this, "databasePromise", void 0);
  		_defineProperty(this, "released", false);
  		this.factory = factory;
  		this.databaseName = databaseName;
  		this.now = now;
  	}
  	async set(namespaceValue, keyValue, value) {
  		const namespace = normalizeNamespace(namespaceValue);
  		const key = normalizeKey(keyValue);
  		const transaction = (await this.database()).transaction(STORE_NAME, "readwrite");
  		transaction.objectStore(STORE_NAME).put({
  			id: entryId(namespace, key),
  			namespace,
  			key,
  			value,
  			updatedAt: this.now()
  		});
  		await transactionDone(transaction);
  	}
  	async get(namespaceValue, keyValue) {
  		return (await this.read(namespaceValue, keyValue))?.value;
  	}
  	async has(namespaceValue, keyValue) {
  		return await this.read(namespaceValue, keyValue) !== void 0;
  	}
  	async delete(namespaceValue, keyValue) {
  		const namespace = normalizeNamespace(namespaceValue);
  		const key = normalizeKey(keyValue);
  		const transaction = (await this.database()).transaction(STORE_NAME, "readwrite");
  		const store = transaction.objectStore(STORE_NAME);
  		const id = entryId(namespace, key);
  		const existed = await requestResult(store.getKey(id)) !== void 0;
  		if (existed) store.delete(id);
  		await transactionDone(transaction);
  		return existed;
  	}
  	async list(namespaceValue) {
  		const namespace = normalizeNamespace(namespaceValue);
  		const transaction = (await this.database()).transaction(STORE_NAME, "readonly");
  		const entries = await requestResult(transaction.objectStore(STORE_NAME).getAll());
  		await transactionDone(transaction);
  		return entries.filter((entry) => entry.namespace === namespace).map((entry) => entry.key).sort(compareText);
  	}
  	release() {
  		this.released = true;
  		this.databasePromise?.then((database) => database.close());
  		this.databasePromise = void 0;
  	}
  	async read(namespaceValue, keyValue) {
  		const namespace = normalizeNamespace(namespaceValue);
  		const key = normalizeKey(keyValue);
  		const transaction = (await this.database()).transaction(STORE_NAME, "readonly");
  		const entry = await requestResult(transaction.objectStore(STORE_NAME).get(entryId(namespace, key)));
  		await transactionDone(transaction);
  		return entry;
  	}
  	database() {
  		if (this.released) throw new KvsError("KVS_RELEASED", "The store has been released.");
  		this.databasePromise ?? (this.databasePromise = openDatabase(this.factory, this.databaseName));
  		return this.databasePromise;
  	}
  };
  function normalizeNamespace(value) {
  	const normalized = value.normalize("NFC");
  	if (!/^[a-z][a-z0-9.-]{0,63}$/u.test(normalized)) throw new KvsError("KVS_NAMESPACE_INVALID", "Namespace must be 1-64 lowercase ASCII characters.");
  	return normalized;
  }
  function normalizeKey(value) {
  	const normalized = value.normalize("NFC");
  	if (normalized.length === 0 || normalized.length > 512 || normalized.includes("\0")) throw new KvsError("KVS_KEY_INVALID", "Key must contain 1-512 characters and no NUL.");
  	if (normalized.split("/").some((segment) => segment === "." || segment === "..")) throw new KvsError("KVS_KEY_INVALID", "Key must not contain traversal segments.");
  	return normalized;
  }
  function entryId(namespace, key) {
  	return `${namespace}\0${key}`;
  }
  function openDatabase(factory, name) {
  	return new Promise((resolve, reject) => {
  		const request = factory.open(name, 1);
  		request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
  		request.onsuccess = () => resolve(request.result);
  		request.onerror = () => reject(new KvsError("KVS_STORAGE_FAILURE", "Could not open IndexedDB.", request.error));
  	});
  }
  function requestResult(request) {
  	return new Promise((resolve, reject) => {
  		request.onsuccess = () => resolve(request.result);
  		request.onerror = () => reject(new KvsError("KVS_STORAGE_FAILURE", "IndexedDB request failed.", request.error));
  	});
  }
  function transactionDone(transaction) {
  	return new Promise((resolve, reject) => {
  		transaction.oncomplete = () => resolve();
  		transaction.onabort = () => reject(new KvsError("KVS_STORAGE_FAILURE", "IndexedDB transaction aborted.", transaction.error));
  		transaction.onerror = () => reject(new KvsError("KVS_STORAGE_FAILURE", "IndexedDB transaction failed.", transaction.error));
  	});
  }
  function compareText(left, right) {
  	return left < right ? -1 : left > right ? 1 : 0;
  }
  //#endregion
  //#region src/extension.ts
  var blockDefinitions = block_definitions_default.blocks;
  var KvsExtension = class {
  	constructor(store = new IndexedDbKvsStore()) {
  		_defineProperty(this, "store", void 0);
  		this.store = store;
  	}
  	getInfo() {
  		return {
  			id: extensionConfig.id,
  			name: Scratch.translate(block_definitions_default.extensionName),
  			docsURI: extensionConfig.docsURI,
  			blockIconURI: extensionConfig.blockIconURI,
  			blocks: blockDefinitions.map((block) => this.toScratchBlock(block))
  		};
  	}
  	async setValue(args) {
  		await this.store.set(text(args.NAMESPACE), text(args.KEY), text(args.VALUE));
  	}
  	async getValue(args) {
  		return await this.store.get(text(args.NAMESPACE), text(args.KEY)) ?? "";
  	}
  	async hasKey(args) {
  		return this.store.has(text(args.NAMESPACE), text(args.KEY));
  	}
  	async deleteKey(args) {
  		await this.store.delete(text(args.NAMESPACE), text(args.KEY));
  	}
  	async listKeys(args) {
  		return JSON.stringify(await this.store.list(text(args.NAMESPACE)));
  	}
  	toScratchBlock(block) {
  		return {
  			opcode: block.opcode,
  			blockType: Scratch.BlockType[block.blockType],
  			text: Scratch.translate(block.text),
  			arguments: Object.fromEntries(Object.entries(block.arguments).map(([name, argument]) => [name, {
  				type: Scratch.ArgumentType[argument.type],
  				defaultValue: argument.defaultValue
  			}]))
  		};
  	}
  };
  function text(value) {
  	return Scratch.Cast.toString(value);
  }
  //#endregion
  //#region src/index.ts
  if (extensionConfig.unsandboxed && !Scratch.extensions.unsandboxed) throw new Error(`${extensionConfig.name} must run unsandboxed.`);
  Scratch.extensions.register(new KvsExtension());
  //#endregion

})(Scratch);
