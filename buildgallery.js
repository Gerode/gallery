
var async = require('async');
var gm = require('gm')
            .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');
var fs = require('fs');
var xml2js = require('xml2js');

// constants
var MAX_WIDTH  = 100;
var MAX_HEIGHT = 100;
var srcBucket = "../holtfamilytree.com/reunions/images";
var dstBucket = "test";

function processImage(srcKey, callback) {

    var dstKey    = "resized-" + srcKey;

    // Download the image from S3, transform, and upload to a different S3 bucket.
    async.waterfall([
        function download(next) {
//          console.log("download(): " + srcKey);
          next(null, srcBucket + "/" + srcKey);
        },
            
        function transform(response, next) {
//          console.log("transform(): " + response);
          gm(response).size(function(err, size) {
            console.log(size);
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
        function upload(contentType, data, next) {
//          console.log("upload(): " + contentType);
          fs.writeFile(dstBucket + '/' + dstKey, data);
          next(null, data);
        },
        function readXmp(data, next) {
//          console.log("readXmp(): " + srcKey);
          gm(srcBucket + '/' + srcKey).toBuffer("XMP", next);
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
        }
      ], 
      callback
/*      function finalCallback(err, figure) {
            if (err) {
                console.error(
                    'Unable to resize ' + srcBucket + '/' + srcKey +
//                    ' and upload to ' + dstBucket + '/' + dstKey +
                    ' due to an error: ' + err
                );
            } else {
//                console.log(
//                    'Successfully resized ' + srcBucket + '/' + srcKey +
//                    ' and uploaded to ' + dstBucket + '/' + figure[1]
//                );
            }
        }*/
    );
}

fs.readdir(srcBucket, null, function (err, images) {
  async.map(images.filter(function(srcKey) {return srcKey.startsWith('2016') && srcKey.endsWith('g');}), processImage, function(err, result) {
    console.log('map() callback');
    if (err) {
      console.error('map() error: ' + err);
    }
    else {
      console.log('<div id="gallery">\n' + result.join('\n') + '\n</div>');
    }
  });
});

