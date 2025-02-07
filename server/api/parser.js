/* MANEJO DE TAGS, COMANDOS, ETC. DENTRO DE LOS CAMPOS DE ENTRADA. */
const dbManager = require('../db/dbmanager.js');
const mdbScheme = require('../db/models/mdbscheme.js');
const jsonScheme = require('../db/models/jsonscheme.js');
const utils = require('../utils.js');
const pass = require('./passport.js');
const live = require('./live.js');
const malbot = require('../extra/malbot.js');

//FUNCION: maneja el texto de entrada de un comentario.
function parseComInput(DB, bid, cid, uid, rawtext){
	//se invoca al parser de tags con el texto del comentario, este añade los tags y notifica a los demas usuarios.
	parseTags(DB, cid, uid, rawtext);
	
	//detecta los comandos especiales, desactivable.
	parseCommands(DB, bid, cid, uid, rawtext);
	
	//retorna el texto del comentario modificado para la base de datos y sanitizado.
	return htmlSanitize(rawtext);
}

//FUNCION: detecta comandos y tags y los modifica para ser guardado en la base de datos.
function htmlSanitize(rawtext){
	let patterns = [
		/(<(.*?)>|<(.*?)(\r\n|\r|\n)+)/g, //tags html en general.
		/::{1}([^\r\n\s]+)/gi, //link interno
		/>>{1}([^\r\n\s]{7})/gi, //tags
		/>(([https?|ftp]+:\/\/)([^\s/?\.#]+\.?)+(\/[^\s]*)?)/gi, //link externo
		/^(>(?!\>).+)/gim, //greentext
		/\$([0-9A-Fa-f]{3})([^]*?)\$/g, //deteccion de color rgb
		/\n/g //salto de linea.
	];
	let pattern_replace = [
		'',
		'<a href="$1" class="link">&gt;$1</a>',
		'<a href="#$1" class="tag" data-tag="$1">&gt;&gt;$1</a>',
		'<a href="$1" target="_blank" class="link">&gt;$1</a>',
		'<span class="greentext">$1</span>',
		'<span style="color: #$1;text-shadow: 1px 1px black;">$2</span>',
		'<br>'
	]
	let output = rawtext.replace(/[\r\n]+$/, ''); //limpiar espacios innecesarios.
	
	for (var i =0; i < patterns.length; i++) {
		output = output.replace(patterns[i], pattern_replace[i]);
	}
	return output;
	
}

//FUNCION: se encarga de detectar los tags y actualizar la informacion en la base de datos.
//TODO: mover el notification builder a un modulo independiente.
function parseTags(DB, cid, uid, rawtext){
	let tags = rawtext.match(/>>{1}([^\r\n\s]{7})/gi);
	
	//comprobar si se encontraron tags en el comentario
	if (tags){
		//si se detectan tags, iterar en cada uno
		tags.forEach(async function(item, i){
			
			//se elimina el "#" y se añade el cid dentro del registro de tags del comentario taggeado
			let selcid = tags[i].substring(2);
			dbManager.pushDB(DB, mdbScheme.C_COMS, {cid: selcid}, {$push: {"content.extra.tags": cid}});
			
			//let timestamp = Date.now();
			
			//se lee la informacion del comentario receptor y el box al que pertenece
			let c_receiver = await dbManager.queryDB(DB, mdbScheme.C_COMS, {cid: selcid}, "", function(){});
			let box = await dbManager.queryDB(DB, mdbScheme.C_BOXS, {bid: c_receiver[0].bid}, "", function(){});
			
			//comprueba si el usuario se taggea a si mismo, para cancelar la notificacion.
			if (c_receiver[0].user.uid != uid){
				
				//de lo contrario, clona el esquema de notificaciones y añade la nueva info.
				let notifdata = utils.clone(jsonScheme.NOTIF_SCHEME);
				notifdata.sender.uid = uid;
				notifdata.receiver.uid = c_receiver[0].user.uid;
				notifdata.date.created = Date.now();
				notifdata.state.push("new");
				notifdata.content.cid = cid;
				notifdata.content.bid = c_receiver[0].bid;
				notifdata.content.tag = true;
				notifdata.content.preview = {
					title: box[0].content.title,
					desc: htmlSanitize(rawtext),
					thumb: (box[0].type.includes("video")) ? box[0].media.preview : box[0].img.preview
				}
				
				//envia la notificacion por websockets y la guarda en la base de datos
				await dbManager.insertDB(DB, mdbScheme.C_NOTIF, notifdata, function(){});
				live.sendDataTo(c_receiver[0].user.uid, "notif", pass.filterProtectedUID(notifdata));
			}
		});
	}
	
	//return []; //retorno irrelevante.
}

//FUNCION: detecta comandos dentro del comentario enviado y reacciona independientemente.
function parseCommands(DB, bid, cid, uid, rawtext){	
	/* Comandos del malbot */
	//TODO: mover esto dentro del modulo del bot.
	let malsearch = new RegExp(/\$malsearch[^.](.+)/gi).exec(rawtext);
	let malview = new RegExp(/\$malinfo[^.](.+)/gi).exec(rawtext);
	let malcheck = new RegExp(/\$malcheck[^.](.+)/gi).exec(rawtext);
	let malsimil = new RegExp(/\$malsimil[^.](.+)/gi).exec(rawtext);
	
	if (malsearch != null){
		malbot.searchAnime(DB, bid, malsearch[1], function(result){});
	}
	
	if (malview != null){
		malbot.previewAnime(DB, bid, malview[1], function(result){});
	}
	
	if (malcheck != null){
		malbot.listAnimes(DB, bid, malcheck[1], function(result){});
	}
	
	if (malsimil != null){
		malbot.similarAnimes(DB, bid, malsimil[1], function(result){});
	}
	/* fin de comandos del malbot */
}

module.exports = {parseComInput, htmlSanitize, parseTags}