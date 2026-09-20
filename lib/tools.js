'use strict';

async function existsState(adapter, id, callback) {
	if (typeof callback === 'function') {
		adapter.getObject(id, (err, obj) => callback(err, obj && obj.type === 'state'));
	} else {
		const obj = await adapter.getObjectAsync(id);
		if (obj) {
			return obj.type === 'state';
		}
	}
}

async function deleteState(adapter, id, callback) {
	if (typeof callback === 'function') {
		adapter.delObject(id, { recursive: false }, callback);
	} else {
		return await adapter.delObjectAsync(id, { recursive: false });
	}
}

module.exports = {
	existsState,
	deleteState,
};
