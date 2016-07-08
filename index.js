var loader = require("./lib/loader.js");

var instance = null;
module.exports = function(dir_path){
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
