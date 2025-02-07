/* COMPRUEBA LA JERARQUIA, BANEOS, WHITELIST, ETC. */
const dbManager = require('../db/dbmanager.js');
const mdbScheme = require('../db/models/mdbscheme.js');
const sConfig = require('../config/serverconfig.js');
const utils = require('../utils.js');
const sesionManager = require('../sesion/sesionmanager.js');

/* MIDDLEWARES */

//MIDDLEWARE: comprobacion de uso generalizado.
function check(req, res, next){
	checkBan(req, res, function(ban){
		if (ban){
			res.send(ban);
		} else {
			next();
		}
	});
}

//MIDDLEWARE: permite el acceso solo a usuarios con rangos de alta jerarquia.
function onlyADM(req, res, next){
	let userData = sesionManager.getUserData(req.session.id)[0].data;
	if (userData.permisos.includes("ADMIN") || userData.permisos.includes("GMOD")){
		next();
	} else {
		res.status(403);
		res.redirect("/error/2");
	}
}

//MIDDLEWARE: permite el acceso solo a usuarios con rangos de baja y alta jerarquia.
function onlyMOD(req, res, next){
	let userData = sesionManager.getUserData(req.session.id)[0].data;
	if (userData.permisos.includes("ADMIN") || userData.permisos.includes("GMOD") || userData.permisos.includes("MOD")){
		next();
	} else {
		res.status(403);
		res.redirect("/error/2");
	}
}

//MIDDLEWARE: comprueba los campos de entrada de creacion de temas.
function checkBoxFields(req, res, next){
	boxFields(req, res, function(data){
		if (data){
			res.send(data);
		} else {
			next();
		}
	});
}

//MIDDLEWARE: comprueba los campos de entrada de creacion de comentarios.
function checkComFields(req, res, next){
	comFields(req, res, function(data){
		if (data){
			res.send(data);
		} else {
			next();
		}
	});
}

/* UTILITARIOS */
function boxFields(req, res, callback){
	checkRecursiveRequest(req, res, mdbScheme.C_BOXS, sConfig.BOX_DELAY, async function(rreq){
		if (rreq){
			res.send(rreq);
		} else {
			//obtener info del usuario y la categoria.
			let userdata = sesionManager.getUserData(req.session.id)[0].data;
			let catdata = await dbManager.queryDB(req.app.locals.db, mdbScheme.C_CATS, {catid: req.fields.cat}, "", function(){});
			
			if (!userdata.permisos.includes("CREAR_BOX")){
				callback({success: false, data: "No tienes permitido crear temas"});
			} else if (catdata[0] && (catdata[0].state.includes("ADMONLY") && !userdata.permisos.includes("ADMIN"))){
				callback({success: false, data: "Categoría restringida a la administracion."});
			} else if (!req.fields.cat || req.fields.cat.trim() === ""){
				callback({success: false, data: "Elige una categoria valida"});
			} else if (!req.fields.title || req.fields.title.trim() === "") {
				if (req.fields.title.trim().length < 5){
					callback({success: false, data: "El titulo es muy corto"});
				} else {
					callback({success: false, data: "Falta un titulo"});
				}
			} else if (req.fields.img.trim() === "" && req.fields.vid.trim() === "") {
				callback({success: false, data: "Añade una imagen o video"});
			} else {
				callback(null);
			}
			
		}
	})
}

function comFields(req, res, callback){
	checkRecursiveRequest(req, res, mdbScheme.C_COMS, sConfig.COMMENT_DELAY, function(rreq){
		if (rreq){
			res.send(rreq);
		} else {
			checkTags(req, res, function(tres){
				if (tres){
					callback(tres);
				} else {
					let userdata = sesionManager.getUserData(req.session.id)[0].data;
					if (!userdata.permisos.includes("CREAR_COM")){
						callback({success: false, data: "No tienes permitido comentar"});
					} else if (req.fields.img.trim() === "" && req.fields.vid.trim() === ""){
						if (req.fields.content.trim() === ""){
							callback({success: false, data: "Escribe algo o sube una imagen."});
						} else {
							callback(null);
						}
					} else {
						callback(null);
					}
				}
			});
		}
	});
}

//FUNCION: micro parser que analiza los tags
function checkTags(req, res, callback){
	let tags = (req.fields.content).match(/>>{1}([^\r\n\s]{7})/gi);
	if (tags !== null){
		if (tags.length > sConfig.MAX_TAGS){
			callback({success: false, data: `Máximo permitido ${sConfig.MAX_TAGS} tags.`});
		} else {
			for (var i=0; i < tags.length; i++) {
				for (var x=0; x < tags.length; x++){
					if ((i != x) && (tags[i] === tags[x])){
						return callback({success: false, data: "Hay tags repetidos"});
					}
				}	
			}
			callback(null); //al no haber repetidos
		}
	} else {
		callback(null); //al no haber tags
	}
}

//FUNCION: calcula el tiempo del ultimo comentario guardado y el momento del request actual.
function checkRecursiveRequest(req, res, cname, delay, callback){
	let currentTimestamp = Date.now();
	dbManager.queryDB(req.app.locals.db, cname, {"user.uid": req.session.uid}, {"date.created": -1}, function(coms){
		if (coms[0]){
			let ultimoComentario = coms[0].date.created;
			let diferencia = (currentTimestamp - ultimoComentario) / 1000;
			let faltan = delay - diferencia;
			if (diferencia < delay){
				callback({success: false, data: `Espera ${Math.round(faltan)} segundos.`});
			} else {
				callback(null);
			}
		} else {
			callback(null);
		}
	});
}

function checkBan(req, res, callback){
	dbManager.queryDB(req.app.locals.db, mdbScheme.C_ADM, {uid: req.session.uid}, "", function(userdata){
		if (userdata[0] && userdata[0].state.includes("BANNED")){
			callback({success: false, data: {banned: true, bandata: userdata[0].extra.bandata}});
		} else {
			callback(null);
		}
	});
}

function filterProtectedUID(arr){
	//proteger el uid reemplazandola en el array.
	if (Array.isArray(arr)){
		let arcopy = JSON.parse(JSON.stringify(arr)); //clonar arrays en javascript be like.......
		arcopy.forEach(function(elem){
			if (elem.user){
				elem.user.uid = "-privado-";
			} else {
				elem.sender.uid = "-privado-";
				elem.receiver.uid = "-privado-";
			}
		});
		return arcopy;
	} else {
		if (arr){
			let jcopy = utils.clone(arr);
			if (jcopy.user){
				jcopy.user.uid = "-privado-";
			} else {
				jcopy.sender.uid = "-privado-";
				jcopy.receiver.uid = "-privado-";
			}
			return jcopy;
		}
	}
}

module.exports = {check, checkBoxFields, checkComFields, filterProtectedUID, onlyADM, onlyMOD}