module.exports.root_dir_test = function(){
	return require("../../index.js")("/sql");
}

module.exports.caller_dir_test = function(){
	return require("../../index.js")("../sql");
}