
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm')
            .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');
var xml2js = require('xml2js');
var fs = require('fs');

// constants
var MAX_WIDTH  = 160;
var MAX_HEIGHT = 160;
var srcBucket = "gerodephotos";
var dstBucket = "gerodephotos";

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

          async.waterfall([
            function readXmp(next) {
//              console.log("readXmp(): " + srcKey);
              gm(response.Body).toBuffer("XMP", next);
            },
            function extract(xmpData, next) {
    //          console.log("extract(): " + srcKey);
              //console.log("raw data: " + xmpData);
              xml2js.Parser().parseString(xmpData, function (err, result) {
                var caption = result['x:xmpmeta']['rdf:RDF'][0]['rdf:Description'][0]['dc:description'][0]['rdf:Alt'][0]['rdf:li'][0]["_"];
    //            console.log('caption: ' + caption);
                next(null, [srcKey, dstKey, caption]);
              });
            },
            function publish(photo, next) {
    //          console.log("publish(): " + photo);
              next(null, 
                  '<figure><a href="/' + photo[0] + '" class="thumbnail">\n' +
                  '  <img src="/' + photo[1] + '" alt="' + photo[2] + '" class="thumbnail">\n' +
                  '  <figcaption>' + photo[2] + '</figcaption>\n' +
                  '</a></figure>');
            }],
            outernext
          );
        },
            
      ], 
      callback
    );
}

async.waterfall([
  function listObjects(next) {
    s3.listObjectsV2({Bucket: srcBucket, MaxKeys: 20}, next);
  },
  function processImages(images, next) {
    console.log("processImages(): " + images);
    async.map(images['Contents'].filter(function(object) {return object['Key'].startsWith('2013/2013-05/IMG') && object['Key'].endsWith('g');}), processImage, next);
  },
  function createIndex(result, next) {
    s3.putObject(
      {
        Bucket: dstBucket,
        Key: '2013/2013-05/index.html',
        Body: '<html><head><link rel="stylesheet" href="/gallery.css"/></head><body><div id="gallery"><h2><a href="/">Home</a> > <a href="2013">2013</a> > <a href="2013-05">05</a></h2><h1>2013-05</h1>\n' + result.join('\n') + '\n<br><div id="copyright"><a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="https://i.creativecommons.org/l/by-sa/4.0/88x31.png" /></a><br />This work is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International License</a>.</div></div></body></html>',
        ContentType: 'text/html'
      },
      next);
  },
  function createRootIndex(result, next) {
    s3.putObject(
      {
        Bucket: dstBucket,
        Key: 'index.html',
        Body: '<html><head><link rel="stylesheet" href="/gallery.css"/></head><body>Hello, world!</body></html>',
        ContentType: 'text/html'
      },
      next);
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
      console.error('putObject() index  error: ' + err);
    }
  }
);
