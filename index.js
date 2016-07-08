var loader = require("./lib/loader.js");

var instance = null;
module.exports = function(dir_path){
    if(dir_path == null || dir_path == "" || typeof dir_path == 'undefined'){
        if(instance != null) {
            return instance;
        } else {
            throw "Require SQL directory path";
        }
    }

	if(instance == null) {
		instance = new loader(dir_path, _getCallerFile());
	}

	return instance;
}

function _getCallerFile() {
    try {
        var err = new Error();
        var callerfile;
        var currentfile;

        Error.prepareStackTrace = function (err, stack) { return stack; };

        currentfile = err.stack.shift().getFileName();

        while (err.stack.length) {
            callerfile = err.stack.shift().getFileName();

            if(currentfile !== callerfile) return callerfile;
        }
    } catch (err) {}
    return undefined;
}
