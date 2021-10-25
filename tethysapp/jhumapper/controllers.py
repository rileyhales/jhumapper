import glob
import os
import random
import string
import time

import grids
import numpy as np
import pandas as pd

from django.shortcuts import render
from django.http import JsonResponse
from tethys_sdk.permissions import login_required
from tethys_sdk.gizmos import SelectInput

from .app import Jhumapper as App


@login_required()
def home(request):
    """
    Controller for the app home page.
    """
    select_layers = SelectInput(
        display_text='Select data layer',
        name='select-layers',
        multiple=False,
        original=True,
        initial='probability',
        options=(
            ('2018 Monthly Probabilities', 'probability'),
            ('Long Term Symptomatic Rate', 'sympt'),
            ('Long Term Asymptomatic Rate', 'asympt')
        )
    )

    context = {
        "layers": select_layers,
        "thredds_wms_base": App.get_custom_setting("thredds_wms_base"),
    }
    return render(request, 'jhumapper/home.html', context)


# @login_required()
def query_values(request):
    """
    Controller for the app home page.
    """
    workspace_path = App.get_app_workspace().path
    data = dict(request.GET)
    stats = ('max', '75%', 'median', '25%', 'min', 'values')

    ts = grids.TimeSeries(
        files=[os.path.join(workspace_path, 'Shigella_2018.nc4'), ],
        var='probability',
        dim_order=('time', 'lat', 'lon'),
        interp_units=False,
        stats=stats,
        fill_value=np.nan
    )
    plot_type = 'stats'

    if 'point' in data.keys():
        plot_type = 'point'
        coords = data['point'][0].split(',')
        ts = ts.point(None, float(coords[0]), float(coords[1]))
    elif 'rectangle' in data.keys():
        coords = data['rectangle'][0].split(',')
        ts = ts.bound(
            (None, float(coords[0]), float(coords[1])),
            (None, float(coords[2]), float(coords[3])),
        )
    elif 'polygon' in data.keys():
        # delete jsons made more than 5 mins ago
        _2_mins_ago = time.time() - (2 * 60)
        for polygon_json in glob.glob(os.path.join(workspace_path, '*.json')):
            if _2_mins_ago > os.stat(polygon_json).st_ctime:
                os.remove(polygon_json)
        # create a new one with the user's search
        letters = string.ascii_lowercase
        tmpfile = ''.join(random.choice(letters) for i in range(10)) + '.json'
        tmppath = os.path.join(workspace_path, tmpfile)
        with open(tmppath, 'w') as f:
            f.write(str(data['polygon'][0]))
        # use the new one to query a time series
        ts = ts.shape(tmppath, behavior='dissolve')
        for col in ts.columns:
            if '_shape_' in col:
                new_col_name = col.replace('_shape', '')
                ts[new_col_name] = ts[col]
                del ts[col]
    elif 'shape' in data.keys():
        shppath = os.path.join(workspace_path, 'gadm_clipped', 'gadm-level1-clipped.gpkg')
        ts = ts.shape(shppath, behavior='feature', label_attr='GID_1', feature=data['shape'][0])
        for col in ts.columns:
            if f'_{data["shape"][0]}' in col:
                new_col_name = col.replace(f'_{data["shape"][0]}', '')
                ts[new_col_name] = ts[col]
                del ts[col]
    else:
        raise ValueError('Unrecognized query request')

    ts.set_index('datetime', inplace=True)
    ts.index = pd.Index(pd.to_datetime(ts.index, unit="s")).strftime("%Y-%m").to_list()
    ts.round(2)

    if plot_type == 'point':
        return JsonResponse({
            'plotType': plot_type,
            'x': ts.index.tolist(),
            'y': ts['probability'].values.flatten().tolist(),
        })
    else:
        vals = np.array(list(ts['probability_values'].values[i] for i in range(12))).flatten()
        vals = vals[np.logical_not(np.isnan(vals))]
        return JsonResponse({
            'plotType': plot_type,
            'x': ts.index.tolist(),
            'max': ts['probability_max'].values.flatten().tolist(),
            'p75': ts['probability_75%'].values.flatten().tolist(),
            'median': ts['probability_median'].values.flatten().tolist(),
            'p25': ts['probability_25%'].values.flatten().tolist(),
            'min': ts['probability_min'].values.flatten().tolist(),
            'values': vals.tolist()
        })
