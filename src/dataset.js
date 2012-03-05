/**
Library Deets go here
USE OUR CODES

Version 0.0.1.2
*/

(function(global, _, moment) {

  var Miso = global.Miso;

  /**
  * @constructor
  *
  * Instantiates a new dataset.
  * @param {object} options - optional parameters. 
  *   url : "String - url to fetch data from",
  *   jsonp : "boolean - true if this is a jsonp request",
  *   delimiter : "String - a delimiter string that is used in a tabular datafile",
  *   data : "Object - an actual javascript object that already contains the data",
  *   table : "Element - a DOM table that contains the data",
  *   format : "String - optional file format specification, otherwise we'll try to guess",
  *   recursive : "Boolean - if true build nested arrays of objects as datasets",
  *   strict : "Whether to expect the json in our format or whether to interpret as raw array of objects, default false",
  *   extract : "function to apply to JSON before internal interpretation, optional"
  *   ready : the callback function to act on once the data is fetched. Isn't reuired for local imports
  *           but is required for remote url fetching.
  *   columnNames : {
  *     oldName : newName
  *   },
  *   columnTypes : {
  *     name : typeName || { type : name, ...additionalProperties }
  *   }
  *   google_spreadsheet: {
  *     key : "", worksheet(optional) : ""
  *   },
  *   sorted : true (optional) - If the dataset is already sorted, pass true
  *     so that we don't trigger a sort otherwise.
  *   comparator : function (optional) - takes two rows and returns 1, 0, or -1  if row1 is
  *     before, equal or after row2. 
  *   deferred : by default we use underscore.deferred, but if you want to pass your own (like jquery's) just
  *              pass it here.
  }
  */

  Miso.Dataset = function(options) {
    options = options || (options = {});
    this._initialize(options);
    return this;
  };

  _.extend(Miso.Dataset.prototype, Miso.View.prototype, {

    /**
    * @private
    * Internal initialization method. Reponsible for data parsing.
    * @param {object} options - Optional options  
    */
    _initialize: function(options) {

      // is this a syncable dataset? if so, pull
      // required methods and mark this as a syncable dataset.
      if (options.sync === true) {
        _.extend(this, Miso.Events);
        this.syncable = true;
      }

      // initialize importer from options or just create a blank
      // one for now, we'll detect it later.
      this.importer = options.importer || null;

      // default parser is object parser, unless otherwise specified.
      this.parser  = options.parser || Miso.Parsers.Obj;

      // figure out out if we need another parser.
      if (_.isUndefined(options.parser)) {
        if (options.strict) {
          this.parser = Miso.Parsers.Strict;
        } else if (options.delimiter) {
          this.parser = Miso.Parsers.Delimited;
        } else if (options.google_spreadsheet) {
          this.parser = Miso.Parsers.GoogleSpreadsheet;
        }
      }

      // set up some base options for importer.
      var importerOptions = _.extend({}, 
        options,
        { parser : this.parser }
      );

      if (options.delimiter) {
        importerOptions.dataType = "text";
      }

      if (options.google_spreadsheet) {
        _.extend(importerOptions, options.google_spreadsheet);
      }

      // initialize the proper importer
      if (this.importer === null) {
        if (options.url) {
          this.importer = Miso.Importers.Remote;
        } else if (options.google_spreadsheet) {
          this.importer = Miso.Importers.GoogleSpreadsheet;
          delete options.google_spreadsheet;
        } else {
          this.importer = Miso.Importers.Local;
        }
      }

      // initialize actual new importer.
      this.importer = new this.importer(importerOptions);

      // save comparator if we have one
      if (options.comparator) {
        this.comparator = options.comparator;  
      }

      // if we have a ready callback, save it too
      if (options.ready) {
        this.ready = options.ready;
      }

      // if for any reason, you want to use a different deferred
      // implementation, pass it as an option
      if (options.deferred) {
        this.deferred = options.deferred;
      }
    },

    /**
    * Responsible for actually fetching the data based on the initialized dataset.
    * Note that this needs to be called for either local or remote data.
    * There are three different ways to use this method:
    * ds.fetch() - will just fetch the data based on the importer. Note that for async 
    *              fetching this isn't blocking so don't put your next set of instructions
    *              expecting the data to be there.
    * ds.fetch({
    *   success: function() { 
    *     // do stuff
    *     // this is the dataset.
    *   },
    *   error : function(e) {
    *     // do stuff
    *   }
    * })        - Allows you to pass success and error callbacks that will be called once data
    *             is property fetched.
    *
    * _.when(ds.fetch(), function() {
    *   // do stuff
    *   // note 'this' is NOT the dataset.
    * })        - Allows you to use deferred behavior to potentially chain multiple datasets.
    *
    * @param {object} options Optional success/error callbacks.
    **/
    fetch : function(options) {
      options = options || {};
      
      var dfd = this.deferred || new _.Deferred();

      if (this.importer !== null) {

        this.importer.fetch({
          
          success: _.bind(function(d) {
            _.extend(this, d);

            // if a comparator was defined, sort the data
            if (this.comparator) {
              this.sort();
            }

            // call ready method
            if (this.ready) {
              this.ready.call(this);
            }

            // call success method if any passed
            if (options.success) {
              options.success.call(this);
            }

            // resolve deferred
            dfd.resolve(this);

          }, this),

          error : _.bind(function(e) {

            // call error if any passed
            if (options.error) {
              options.error.call(this);
            }

            // reject deferred
            dfd.reject(e);

          }, this)
        });
      }

      return dfd.promise();
    },

    /**
    * Add a row to the dataset
    * TODO: multiple rows?
    * @param {object} row - an object representing a row in the form of:
    * {columnName: value}
    * @param {object} options - options
    *   silent: boolean, do not trigger an add (and thus view updates) event
    */    
    add : function(row, options) {
      if (!row._id) {
        row._id = _.uniqueId();
      }

      this._add(row, options);

      if (this.syncable && (!options || !options.silent)) {
        this.trigger('add', this._buildEvent({ changed : row }) );
        this.trigger('change', this._buildEvent({ changed : row }) );
      }
    },

    /**
    * Remove all rows that match the filter
    * TODO: single row by id?
    * @param {function} filter - function applied to each row
    * @param {object} options - options. Optional.
    *   silent: boolean, do not trigger an add (and thus view updates) event
    */    
    remove : function(filter, options) {
      filter = this._rowFilter(filter);
      var deltas = [];

      this.each(function(row, rowIndex) {
        if (filter(row)) {
          this._remove(row._id);
          deltas.push( { old: row } );
        }
      });
      if (this.syncable && (!options || !options.silent)) {
        var ev = this._buildEvent( deltas );
        this.trigger('remove', ev );
        this.trigger('change', ev );
      }
    },

    /**
    * Update all rows that match the filter
    * TODO: dynamic values
    * @param {function} filter - filter rows to be updated
    * @param {object} newProperties - values to be updated.
    * @param {object} options - options. Optional.
    */    
    update : function(filter, newProperties, options) {
      filter = this._rowFilter(filter);

      var newKeys = _.keys(newProperties),
          deltas = [];

      this.each(function(row, rowIndex) {
        if (filter(row)) {
          _.each(this._columns, function(c) {
            if (_.indexOf(newKeys, c.name) !== -1) {

              // test if the value passes the type test
              var Type = Miso.types[c.type];
              
              if (Type) {
                if (Miso.typeOf(newProperties[c.name], c.typeOptions) === c.type) {
                  newProperties[c.name] = Type.coerce(newProperties[c.name], c.typeOptions);
                } else {
                  throw("incorrect value '" + newProperties[c.name] + 
                        "' of type " + Miso.typeOf(newProperties[c.name], c.typeOptions) +
                        " passed to column with type " + c.type);  
                }
              }
              c.data[rowIndex] = newProperties[c.name];
            }
          }, this);

          deltas.push( { _id : row._id, old : row, changed : newProperties } );
        }
      }, this);

      if (this.syncable && (!options || !options.silent)) {
        var ev = this._buildEvent( deltas );
        this.trigger('change', ev );
        this.trigger('remove', ev );
      }

    }

  });
}(this, _, moment));

