
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm')
            .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');
var xml2js = require('xml2js');
var fs = require('fs');

// constants
var MAX_WIDTH  = 300;
var MAX_HEIGHT = 300;
var srcBucket = "gerodephotos";
var dstBucket = "gerodegallery";

AWS.config.loadFromPath('./keys.json');
var s3 = new AWS.S3();

function processImage(s3Object, callback) {
    var srcKey    = s3Object['Key'];
    var dstKey    = "thumb/" + srcKey;

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(outernext) {
//          console.log("download(): " + srcKey);
          // Download the image from S3 into a buffer.
          s3.getObject({
            Bucket: srcBucket,
            Key: srcKey
            },
            outernext);
        },
        function process(response, outernext) {
          async.waterfall([
            function transform(next) {
//              console.log("transform(): " + response);
              gm(response.Body).size(function(err, size) {
                  // Infer the scaling factor to avoid stretching the image unnaturally.
                  var scalingFactor = Math.min(
                      MAX_WIDTH / size.width,
                      MAX_HEIGHT / size.height
                  );
                  var width  = scalingFactor * size.width;
                  var height = scalingFactor * size.height;

                  // Transform the image buffer in memory.
                  this.resize(width, height)
                      .toBuffer("jpg", function(err, buffer) {
                          if (err) {
                              next("transform() " + err, response.ContentType);
                          } else {
                              next(null, response.ContentType, buffer);
                          }
                      });
              });
            },
            function upload(contentType, thumbnail, next) {
//              console.log("upload(): " + dstKey);
              s3.putObject({
                Bucket: dstBucket,
                Key: dstKey,
                Body: thumbnail,
                ContentType: contentType
              },
              next);
            }],
            function (err) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
                    ' and upload to ' + dstBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            }
            });

          function publish(caption, next) {
//              console.log("publish(): " + caption);
            next(null, 
                '<figure><a href="/images/' + srcKey + '" class="thumbnail">\n' +
                '  <img src="/' + dstKey + '" alt="' + caption + '" class="thumbnail">\n' +
                '  <figcaption>' + caption + '</figcaption>\n' +
                '</a></figure>');
          };

          async.waterfall([
            function readXmp(next) {
//              console.log("readXmp(): " + srcKey);
              gm(response.Body).toBuffer("XMP", next);
            },
            function extract(xmpData, next) {
//              console.log("extract(): " + srcKey);
              //console.log("raw data: " + xmpData);
              xml2js.Parser().parseString(xmpData, function (err, result) {
                var caption = result['x:xmpmeta']['rdf:RDF'][0]['rdf:Description'][0]['dc:description'][0]['rdf:Alt'][0]['rdf:li'][0]["_"];
                next(null, caption);
              });
            }],
            function(err, result) {
              if (err) {
                console.error('process() ' + srcKey + ' metadata error: ' + err);
                publish('', outernext);
              }
              else {
                publish(result, outernext);
              }
            }
          );
        },
            
      ], 
      callback
    );
}

function htmlTree(galleryMetadata) {
//  console.log("htmlTree(): " + galleryMetadata);
  if (Array.isArray(galleryMetadata)) {
    return '<li><a href="/' + galleryMetadata[0] + '">' + galleryMetadata[0] + '</a><ul>' + galleryMetadata[1].map(htmlTree).join('\n') + '</ul></li>';
  }
  else {
    return '<li><a href="/' + galleryMetadata['Root'] + '">' + galleryMetadata['Root'] + ' ' + galleryMetadata['Title'] + '</a></li>';
  }
}

function htmlNav(pageRoot) {
  var pages = pageRoot.split('/').filter(function(page) {return page.length > 0});
  return '<h2><a href="/">' + dstBucket + '</a>' + pages.map(function(page, ndx) {
    return ' > <a href="/' + pages.slice(0, ndx+1).join('/') + '">' + page + '</a>';
  }).join('') + '</h2>';
}

function htmlCopyright() {
  return '<br><div id="copyright"><a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International License</a>.</div>';
}

function generateGallery(galleryRoot, callback) {
  async.waterfall([
    function listObjects(next) {
      s3.listObjectsV2({Bucket: srcBucket, MaxKeys: 10, Prefix: galleryRoot + '/'}, next);
    },
    function processImages(images, next) {
//      console.log("processImages(): " + images['Contents']);
      async.map(images['Contents'].filter(function(object) {return object['Key'].endsWith('g');}), processImage, next);
    },
    function parseMetadata(result, next) {
      next(null, result, {'Root': galleryRoot, 'Title': 'Turkey TODO'});//TODO externalize
    },
    function createIndex(figures, metadata, next) {
      s3.putObject(
        {
          Bucket: dstBucket,
          Key: galleryRoot + '/index.html',
          Body: '<html><head><link rel="stylesheet" href="/gallery.css"/><title>' + dstBucket + ' ' + metadata['Root'] + ' ' + metadata['Title'] + '</title></head><body><div id="gallery">' + htmlNav(galleryRoot) + '<h1>' + metadata['Title'] + '</h1>\n' + figures.join('\n') + '\n' + htmlCopyright() + '</div></body></html>',
          ContentType: 'text/html'
        },
        function(err, data) {next(err, metadata);});
    }],
    function(err, result) {
      if (err) {
        console.error('generateGallery() ' + galleryRoot + ' error: ' + err);
      }
      else {
        callback(null, result);
      }
    }
  );
}

function createDirIndex(galleryMetadata, next) {
  var root = galleryMetadata[0];
console.log("createDirIndex(): " + root + ", galleryMetadata: " + galleryMetadata);
  s3.putObject(
    {
      Bucket: dstBucket,
      Key: (root.length > 0 ? root + '/':'') + 'index.html',
      Body: '<html><head><link rel="stylesheet" href="/gallery.css"/><title>' + dstBucket + ' ' + root + '</title></head><body><div id="gallerydir">' + htmlNav(root) + '<ul>' + galleryMetadata[1].map(htmlTree).join('') + '</ul>' + htmlCopyright() + '</div></body></html>',
      ContentType: 'text/html'
    },
    function(err, results) {next(err, galleryMetadata);});
}
function generateGalleries(galleryInfos, callback) {
//  console.log('generateGalleries() ' + galleryInfos + ' started');
  if (Array.isArray(galleryInfos)) {
    async.map(galleryInfos[1], generateGalleries, function(err, results, metadata) {
      console.log('generateGalleries() ' + galleryInfos + ' results: ' + results);
      if (err) {
        console.error('generateGalleries() ' + galleryInfos[0] + ' error: ' + err);
      }
      else {
        createDirIndex([galleryInfos[0], results], callback);
      }
    });
  }
  else {
    generateGallery(galleryInfos, callback);
  }
}

async.waterfall([
  function generateAllGalleries(next) {
    generateGalleries(['', [['2013', ['2013/05']], ['2014', ['2014/02', '2014/03']]]], next);
  },
  function createStylesheet(result, next) {
    s3.putObject(
      {
        Bucket: dstBucket,
        Key: 'gallery.css',
        Body: fs.readFileSync('gallery.css'),
        ContentType: 'text/css'
      },
      next);
  }],
  function(err, result) {
    if (err) {
      console.error('top-level error: ' + err);
    }
  }
);
