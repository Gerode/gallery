
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm')
            .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');
var xml2js = require('xml2js');

// constants
var MAX_WIDTH  = 150;
var MAX_HEIGHT = 150;
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
                  '<figure><a href="' + photo[0] + '" class="thumbnail">\n' +
                  '  <img src="' + photo[0] + '" alt="' + photo[2] + '" class="thumbnail">\n' +
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

s3.listObjectsV2({Bucket: srcBucket, MaxKeys: 10}, function (err, images) {
  if (err) {
    console.error('listObjectsV2() error: ' + err, err.stack);
  }
  else {
//    console.log(images);
    async.map(images['Contents'].filter(function(object) {return object['Key'].startsWith('2013/2013-05/IMG') && object['Key'].endsWith('g');}), processImage, function(err, result) {
      if (err) {
        console.error('map() error: ' + err);
      }
      else {
        console.log('<div id="gallery">\n' + result.join('\n') + '\n</div>');
      }
    });
  }
});
