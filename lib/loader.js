'use strict';

let fs = require('fs');
let path = require('path');

class SqlLoader{
	constructor(sql_dir, caller_file) {
		let caller_dir = path.dirname(caller_file);
		let main_dir = path.dirname(require.main.filename)

		let sql_dir_path = "";

		if(path.isAbsolute(sql_dir)){
			sql_dir_path = main_dir + sql_dir;
		} else {
			sql_dir_path = path.join(caller_dir, "/", sql_dir);
		}

		this.load(sql_dir_path)

		return this;
	}

	load(dir_path) {
		try {
			this.searchDirectory(dir_path, this)
		} catch (e) {
			console.error(e);
			throw e;
		}
	}

	searchDirectory(dir_path, obj){
		let files = fs.readdirSync(dir_path);

		for(var i = 0, len = files.length; i < len; i ++){
			let file = files[i];
			let filePath = path.join(dir_path, file);
			if(fs.statSync(filePath).isDirectory()){
				obj[file] = {};
				this.searchDirectory(filePath, obj[file]);
			} else if(file.match(/sql/)) {
				obj[file.replace(".sql", "")] = this.getFile(filePath)
			}
		}
	}

	getFile(filepath){
		return fs.readFileSync(filepath, "utf-8");
	}
}


module.exports = SqlLoader