/* MANEJO DE SUBIDA DE ARCHIVOS, SERVIDORES, ETC. */
const fs = require('fs');
const axios = require('axios');
const sharp = require('sharp');
const imgur = require('imgur');
const imgbb = require('imgbb-uploader');
const {imgbox} = require('imgbox');
const imgboxjs = require('imgbox-js');

const ffmpeg = require('fluent-ffmpeg');
const ffmpeg_static = require('ffmpeg-static');
const sConfig = require('../config/serverconfig.js');
const utils = require('../utils.js');
const youtube = require('./youtube.js');
const cloudy = require('./cloudinary.js');

//FUNCION: subida de imagenes, esto se encargaría de seleccionar el servidor configurado por el host, etc.
//TODO: implementar compatibilidad con imgbb
function upload(file, callback){
	//comprobar restricciones de subida
	if (file.size > sConfig.UPLOAD_MAX_SIZE){
		callback({success: false, data: `Imagen muy grande, máximo ${utils.formatBytes(sConfig.UPLOAD_MAX_SIZE)}`});
	} else {
		//seleccionar server y subir archivo.
		switch(sConfig.IMG_SERVER){
			case 0:
				//subida local
				localStore(file, callback);
				break;
			case 1:
				//imgur
				imgurUpload(file, callback);
				break;
			case 2:
				//imgbb
				//callback({success: false, data: "-no implementado-"});
				imgbbUpload(file, callback);
				break;
			case 3:
				//cloudinary
				cloudyUpload(file, callback);
				break;
			case 4:
				//imgbox
				imgboxUpload(file, callback);
				break;
			case 9:
				//flag que desactiva la subida de imagenes.
				callback({success: false, data: "Subida de imagenes no permitida"});
		}
	}
}

//FUNCION: subida de videos
function uploadVid(file, callback){
	if (file.size > sConfig.UPLOAD_MAX_SIZE){
		callback({success: false, data: `Tamaño del video muy grande, máximo ${utils.formatBytes(sConfig.UPLOAD_MAX_SIZE)}`});
	} else {
		switch(sConfig.VIDEO_SERVER){
			case 0:
				localStore(file, callback);
				break;
			case 1:
				cloudyUpload(file, callback);
				break;
			case 9:
				callback({success: false, data: "Subida de videos no permitida."});
				break;
		}
	}	
}

//FUNCION: subida/manipulacion de links
function uploadLink(url, callback){
	let type = checkURLType(url);
	if (type === "youtube-embed" || type === "youtube-url"){
		//TODO: manipular videos de youtube si es necesario.	
		if (type === "youtube-url"){
			url = "https://www.youtube.com/embed/" + youtube.youtubeParser(url);
		}
		callback({success: true, data: {video: true, type: type, raw: url, thumb: youtube.genYoutubeThumb(url, "mq")}});
	} else if (utils.isImg(url)){
		//aca manipular la imagen, subir al server de preferencia, etc.
		switch(sConfig.IMG_SERVER){
			case 0:
				//subida local
				link2localStore(url, function(data){
					if (data.success){
						callback({success: true, data: {video: false, type: type, raw: data.data.link, thumb: data.data.thumb}});
					} else {
						callback({success: false, data: data.data});
					}
				});
			break;
			case 1:
				//imgur
				imgurURLUpload(url, function(data){
					if (data.success){
						callback({success: true, data: {video: false, type: type, raw: data.data.link, thumb: data.data.thumb}});
					} else {
						callback({success: false, data: data.data});
					}
				});
			break;
			case 2:
				//imgbb
				imgbbURLUpload(url, function(data){
					if (data.success){
						callback({success: true, data: {video: false, type: type, raw: data.data.link, thumb: data.data.thumb}});
					} else {
						callback({success: false, data: data.data});
					}
				});
			break;
			case 3:
				//cloudinary
				cloudy.uploadImg(url, function(data){
					callback({success: true, data: {video: false, type: type, raw: data.data.link, thumb: data.data.thumb}});
				});
			break;
			case 4:
				//imgbox
				imgboxURLUpload(url, function(data){
					if (data.success){
						callback({success: true, data: {video: false, type: type, raw: data.data.link, thumb: data.data.thumb}});
					} else {
						callback({success: false, data: data.data});
					}
				});
			break;
			case 9:
				callback({success: false, data: "Subida via links no permitido."});
			break;
		}
		
	} else if (utils.isVideo(url)){
		//si es un link directo a un video, linkearlo con un thumbnail genérico.
		//solo permitir links de cloudinary por ahora.
		if (checkURLType(url) === "cloudinary"){
			if (sConfig.VIDEO_SERVER != 9){
				callback({success: true, data: {video: true, type: type, raw: url, thumb: cloudy.genCloudyThumb(url, true)}});
			} else {
				callback({success: false, data: "Subida via links no permitido."});
			}
		} else {
			callback({success: false, data: {video: true, type: type, raw: url, thumb: "/assets/thumb.jpg"}});
		}
	} else if (utils.isDataImage(url)) {
		dataimg2localStore(url, function(data){
			if (data.success){
				callback({success: true, data: {video: false, type: type, raw: data.data.link, thumb: data.data.thumb}});
			} else {
				callback({success: false, data: null});
			}
		});
	} else {
		callback({success: false, data: null});
	}
}

//FUNCION: subida de base64-data image al localStore
//TODO: no funciona por ahora y no tengo idea porqué..
function dataimg2localStore(url, callback){
	let filename = utils.randomString(16) + ".jpg";
	let path = process.cwd() + "/uploads/" + filename;
	let external_path = "/uploads/" + filename;
	
	let data = url.split(":")[1].split(";");
	let buffer = new Buffer(data[1], 'base64');
	console.log(buffer);
	
	writeFile(path, buffer, function(err){
		if (err){
			callback({success: false, data: err});
		} else {
			genLocalThumb(path, filename, function(resthumb){
				if (resthumb){
					callback({success: true, data: {link: external_path, thumb: resthumb}});
				} else {
					callback({success: false, data: "Hubo un error al subir la imagen."});
				}
			});
		}
	});
}

//FUNCION: subida de url de imagen a localStore.
//TODO: funcionarán los links directos a videos?
function link2localStore(url, callback){
	let namesplit = url.split(".");
	
	//soporte para links que no terminan en un formato.
	if (namesplit[namesplit.length-1].search("/?") != -1){
		namesplit[namesplit.length-1] = namesplit[namesplit.length-1].split("?")[0];
	}
	
	let filename = utils.randomString(16) + "." + namesplit[namesplit.length-1];
	let path = process.cwd() + "/uploads/" + filename;
	let external_path = "/uploads/" + filename;
	
	axios.get(url, {responseType: 'arraybuffer'})
	.then(function(response){
		writeFile(path, response.data, function(err){
			if (err){
				callback({success: false, data: err});
			} else {
				genLocalThumb(path, filename, function(resthumb){
					if (resthumb){
						callback({success: true, data: {link: external_path, thumb: resthumb}});
					} else {
						callback({success: false, data: "Hubo un error al subir la imagen."});
					}
				});
			}
		});
	});
}

//FUNCION: subida de archivos al localStore
function localStore(file, callback){
	let buffer = fs.readFileSync(file.path);
	let filename = utils.randomString(16) + "." + file.type.split("/")[1];
	let path = process.cwd() + "/uploads/" + filename;
	let external_path = "/uploads/" + filename;
    
	writeFile(path, buffer, function(err){
		if (err){
			callback({success: false, data: err});
		} else {
			if (file.type.split("/")[0] === "video"){
				let thumbname = filename.split(".")[0] + "_thumb.png";
				let thumb_path = process.cwd() + "/uploads/";
				ffmpeg(path).setFfmpegPath(ffmpeg_static)
				.screenshots({
					timestamps: [0.0],
					filename: thumbname,
					folder: thumb_path,
					size: '?x250'
				}).on('end', function() {
					callback({success: true, data: {link: external_path, thumb: "/uploads/" + thumbname}});
				});
			} else {
				genLocalThumb(path, filename, function(resthumb){
					if (resthumb){
						callback({success: true, data: {link: external_path, thumb: resthumb}});
					} else {
						callback({success: false, data: "Hubo un error al subir la imagen."});
					}
				});
			}
			
		}
	});
}

//FUNCION: escribe un buffer de datos en un archivo en el localStore
function writeFile(path, buffer, callback){
	fs.writeFile(path, buffer, function(err){
		if (err){
			callback(err);
		} else {
			callback(null);
		}
	});
}

//FUNCION: genera thumbnails de imagenes en el localStore.
function genLocalThumb(path, filename, callback){
	let name = filename.split(".");
	//pasar formato a webp
	name[1] = "webp";
	let thumbPath = process.cwd() + "/uploads/" + name[0] + "_thumb." + name[1];
	sharp(path)
	.resize(sConfig.IMG_LOCAL_THUMBNAIL_SIZE)
	.webp({quality: 90})
	.toBuffer()
	.then(function(data){
		writeFile(thumbPath, data, function(rerr){
			if (!rerr){
				callback("/uploads/" + name[0] + "_thumb." + name[1]);
			} else {
				callback(null);
			}
		});
	}).catch(function(err){
		callback(null);
	});
		
}

//FUNCION: subida de archivos a imgbox
function imgboxUpload(file, callback){
	imgbox([{filename: file.name, buffer: fs.readFileSync(file.path), thumbnail_size: sConfig.IMGBOX_THUMBNAIL_CONFIG}])
	.then(function(result){
		callback({success: true, data: {link: result.files[0].original_url, thumb: result.files[0].thumbnail_url}});
	})
}

//FUNCION: subida via url a imgbox
function imgboxURLUpload(url, callback){
	let options = {
		content_type: "adult",
		thumbnail_size: sConfig.IMGBOX_THUMBNAIL_CONFIG,
		comments_enabled: false,
		logger: false //solo para debug
	};

	imgboxjs.imgbox(url, options).then(function(result){
		callback({success: true, data: {link: result.data[0].original_url, thumb: result.data[0].thumbnail_url}});
	});
}

//FUNCION: subida de archivos a imgbb
function imgbbUpload(file, callback){
	imgbb(sConfig.IMGBB_API_KEY, file.path)
	.then(function(response){
		callback({success: true, data: {link: response.image.url, thumb: response.thumb.url}});
	})
	.catch(function(error){
		callback({success: false, data: error});
	});
}

//FUNCION: subida via link a imgbb
function imgbbURLUpload(url, callback){
	let options = {
		apiKey: sConfig.IMGBB_API_KEY,
		imageUrl: url
	}
	imgbb(options)
	.then(function(response){
		callback({success: true, data: {link: response.image.url, thumb: response.thumb.url}});
	})
	.catch(function(error){
		callback({success: false, data: error});
	});
}

//FUNCION: subida de archivos a cloudinary
function cloudyUpload(file, callback){
	if (file.type.split("/")[0] === "video"){
		cloudy.uploadVid(file, function(data){
			callback(data);
		});
	} else {
		cloudy.uploadImg(file, function(data){
			callback(data);
		});
	}
}

//FUNCION: subida de imagenes via link a imgur.
function imgurURLUpload(url, callback){
	imgur.uploadUrl(url).then((json) => {
		let thumb = genImgurThumb(json.link, sConfig.IMGUR_THUMBNAIL_QUALITY);
		callback({success: true, data: {link: json.link, thumb: thumb}});
	}).catch((err)=> {
		callback({success: false, data: err.message});
	});
}

//FUNCION: subida de imagenes a imgur.
//TODO: comprobar si sube videos cortos
function imgurUpload(file, callback){
	imgur.uploadFile(file.path).then((json) => {
		let thumb = genImgurThumb(json.link, sConfig.IMGUR_THUMBNAIL_QUALITY);
		callback({success: true, data: {link: json.link, thumb: thumb}});
	}).catch((err) => {
		callback({success: false, data: err.message});
	});	
}

//FUNCION: detectar si la url es imgur o cloudinary
function checkURLType(url){
	if (url.search("i.imgur.com") != -1){
		return "imgur";
	} else if (url.search("res.cloudinary.com") != -1){
		return "cloudinary";
	} else if (url.search("i3.ytimg.com") != -1) {
		return "youtube-img";
	} else if (url.search("youtube.com/embed") != -1) {
		return "youtube-embed";
	} else if (url.search("youtube.com/watch") != -1 || url.search("youtu.be") != -1){
		return "youtube-url";
	} else if (url.search("i.ibb.co") != -1) {
		return "imgbb";
	} else {
		return "generic";
	}
}

//FUNCION: detecta la url y devuelve el thumbnail
function genThumb(url){
	switch(checkURLType(url)){
		case "imgur":
			return genImgurThumb(url, sConfig.IMGUR_THUMBNAIL_QUALITY);
		case "cloudinary":
			return cloudy.genCloudyThumb(url);
		case "youtube-img":
			return url;
		case "youtube-embed":
			return youtube.genYoutubeThumb(url, "hq");
		case "imgbb":
		case "generic":
			return url;
	}
	return url;
}

//FUNCION: generar thumbnails de imgur
function genImgurThumb(url, quality){
	let v1 = url.split(".");
	let v2 = v1[v1.length-1];
	let v3 = v2.length+1;
	let res = url.slice(0, -(v3));
	return res + quality + "." + v2;
}

module.exports = {upload, uploadVid, uploadLink, genThumb, checkURLType, genImgurThumb}