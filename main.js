async function fetchAsync(url) {
  const response = await fetch(url, {cache: "force cache"});
	if (response.status != 200) {
		return null;
	}
  const json = await response.json();
  return json;
}

function getSearchParameters() {
  var prmstr = window.location.search.substr(1);
  return prmstr != null && prmstr != "" ? transformToAssocArray(prmstr) : {};
}

function transformToAssocArray( prmstr ) {
  var params = {};
  var prmarr = prmstr.split("&");
  for ( var i = 0; i < prmarr.length; i++) {
    var tmparr = prmarr[i].split("=");
    params[tmparr[0]] = tmparr[1];
  }
  return params;
}

var splitOnce = function(str, delim) {
  var components = str.split(delim);
  var result = [components.shift()];
  if(components.length) {
      result.push(components.join(delim));
  }
  return result;
};

function buildFetchUrl(keyword, argumentCount) {

  var fetchUrl = "https://raw.githubusercontent.com/trovu/trovu/master/shortcuts/o/{%keyword}/{%argumentCount}.call.json"
  var replacements = {
    '{%keyword}': keyword,
    '{%argumentCount}': argumentCount
  }
  for (key in replacements) {
    fetchUrl = fetchUrl.replace(key, replacements[key]);
  }

  return fetchUrl;
}

async function processCall() {

  var params = getSearchParameters();
  var query = params.query;
  var query = decodeURIComponent(params.query);
  query = 'g foo';	
  
  [keyword, argumentString] = splitOnce(query, " ");
  var arguments = argumentString.split(",");
  
  var fetchUrl = buildFetchUrl(keyword, arguments.length);

  var shortcut = await fetchAsync(fetchUrl);

  console.log(shortcut);
  // TODO: Further processing..
  //window.location.href = 'https://google.com';
}

