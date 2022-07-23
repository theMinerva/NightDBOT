var header= "فردریک راسل برنهام";
function getEnglishRedLinks(header){
	let url = "https://fa.wikipedia.org/w/api.php";
	let params = {
		action: "query",
		generator: "links",
		titles: header,
		gpllimit: "1000",
		format: "json"
	};
	url = url + "?origin=*";
	Object.keys(params).forEach(function(key){url += "&" + key + "=" + params[key];});
	fetch(url)
		.then(function(response){return response.json();})
		.then(function(response) {
			let pages = response.query.pages;
			for (let p in pages) {
				if(pages[p].hasOwnProperty("missing")){
					if(/^[a-zA-Z0-9- ]*$/.test(pages[p].title)){
					seeIfFawikiArticle(pages[p].title);
					}
				}
			}
		})
		.catch(function(error){console.log(error);});
}
function seeIfFawikiArticle(entry){
	console.log(entry);
		function getEnSitelink(wikidataID){
		return $.ajax({
			url : '//www.wikidata.org/w/api.php',
			data : {
				action: "wbgetentities",
				origin: location.protocol+"//"+location.hostname,
				format:"json",
				sites:"enwiki",
				titles:entry,
				props:"info|sitelinks",
				languages:"en",
				}
		}).done(function(data){	
		}).fail(function(error){console.log(error);});
}
getEnglishRedLinks(header);