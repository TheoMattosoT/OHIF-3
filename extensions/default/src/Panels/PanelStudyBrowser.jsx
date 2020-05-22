import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
//
import { StudyBrowser, useImageViewer } from '@ohif/ui';
import { DicomMetadataStore } from '@ohif/core';
// This has to import from somewhere else...

function PanelStudyBrowser({
  DisplaySetService,
  getImageSrc,
  getStudiesForPatientByStudyInstanceUID,
  requestDisplaySetCreationForStudy,
  dataSource,
}) {
  // Tabs --> Studies --> DisplaySets --> Thumbnails
  const [{ StudyInstanceUIDs }, dispatch] = useImageViewer();
  const [activeTabName, setActiveTabName] = useState('primary');
  const [studyDisplayList, setStudyDisplayList] = useState([]);
  const [displaySets, setDisplaySets] = useState([]);
  const [thumbnailImageSrcMap, setThumbnailImageSrcMap] = useState(new Map());

  // ~~ studyDisplayList
  useEffect(() => {
    // Fetch all studies for the patient in each primary study
    async function fetchStudiesForPatient(StudyInstanceUID) {
      const qidoStudiesForPatient =
        (await getStudiesForPatientByStudyInstanceUID(StudyInstanceUID)) || [];

      // TODO: This should be "naturalized DICOM JSON" studies
      const mappedStudies = _mapDataSourceStudies(qidoStudiesForPatient);
      const actuallyMappedStudies = mappedStudies.map(qidoStudy => {
        return {
          studyInstanceUid: qidoStudy.StudyInstanceUID,
          date: qidoStudy.StudyDate,
          description: qidoStudy.StudyDescription,
          modalities: qidoStudy.ModalitiesInStudy,
          numInstances: qidoStudy.NumInstances,
          // displaySets: []
        };
      });

      setStudyDisplayList(actuallyMappedStudies);
    }

    StudyInstanceUIDs.forEach(sid => fetchStudiesForPatient(sid));
  }, [StudyInstanceUIDs, getStudiesForPatientByStudyInstanceUID]);

  // ~~ displaySets
  useEffect(() => {
    // TODO: Deep copy? Or By IDs?
    // TODO: May need to be mapped to a different shape?
    // TODO: Iterate over `studyDisplayList` and map these for all studies in list?
    const currentDisplaySets = DisplaySetService.activeDisplaySets || [];
    const mappedDisplaySets = _mapDisplaySets(
      currentDisplaySets,
      thumbnailImageSrcMap
    );

    setDisplaySets(mappedDisplaySets);
  }, [thumbnailImageSrcMap]);

  async function handleDisplaySetsAdded(newDisplaySets) {
    console.warn('~~ handleDisplaySetsAdded');
    // First, launch requests for a thumbnail for the new display sets
    newDisplaySets.forEach(async dset => {
      const imageIds = dataSource.getImageIdsForDisplaySet(dset);
      const imageId = imageIds[Math.floor(imageIds.length / 2)];

      // When the image arrives, render it and store the result in the thumbnailImgSrcMap
      const imageSrc = await getImageSrc(imageId);

      setThumbnailImageSrcMap(
        thumbnailImageSrcMap.set(dset.displaySetInstanceUID, imageSrc)
      );
    });
  }

  useEffect(() => {
    const subscriptions = [
      DisplaySetService.subscribe(
        DisplaySetService.EVENTS.DISPLAY_SETS_ADDED,
        handleDisplaySetsAdded
      ),
      // TODO: Should this event indicate batch/series/study?
      // Naming feels odd, and result is non-obvious
      // Will this always contain _all_ displaySets we care about?
      DisplaySetService.subscribe(
        DisplaySetService.EVENTS.DISPLAY_SETS_CHANGED,
        changedDisplaySets => {
          console.warn('DisplaySetService.EVENTS.DISPLAY_SETS_CHANGED', changedDisplaySets);

          const mappedDisplaySets = _mapDisplaySets(
            changedDisplaySets,
            thumbnailImageSrcMap
          );

          setDisplaySets(mappedDisplaySets);
        }
      ),
    ];

    return () => {
      subscriptions.forEach(sub => sub.unsubscribe);
    };
  }, []);

  const tabs = _createStudyBrowserTabs(
    StudyInstanceUIDs,
    studyDisplayList,
    displaySets
  );

  // TODO: Should "expand" appropriate study (already handled by component?)
  // TODO: Should not fire this on "close"
  function _handleStudyClick(StudyInstanceUID) {
    requestDisplaySetCreationForStudy(DisplaySetService, StudyInstanceUID);
  }

  return (
    <StudyBrowser
      activeTabName={activeTabName}
      tabs={tabs}
      onClickStudy={_handleStudyClick}
      onSetTabActive={setActiveTabName}
    />
  );
}

PanelStudyBrowser.propTypes = {
  DisplaySetService: PropTypes.shape({
    EVENTS: PropTypes.object.isRequired,
    hasDisplaySetsForStudy: PropTypes.func.isRequired,
    subscribe: PropTypes.func.isRequired,
  }).isRequired,
  dataSource: PropTypes.shape({
    getImageIdsForDisplaySet: PropTypes.func.isRequired,
  }).isRequired,
  getImageSrc: PropTypes.func.isRequired,
  getStudiesForPatientByStudyInstanceUID: PropTypes.func.isRequired,
  requestDisplaySetCreationForStudy: PropTypes.func.isRequired,
};

export default PanelStudyBrowser;

/**
 * Maps from the DataSource's format to a naturalized object
 *
 * @param {*} studies
 */
function _mapDataSourceStudies(studies) {
  return studies.map(study => {
    // TODO: Why does the data source return in this format?
    return {
      AccessionNumber: study.accession,
      StudyDate: study.date,
      StudyDescription: study.description,
      NumInstances: study.instances,
      ModalitiesInStudy: study.modalities,
      PatientID: study.mrn,
      PatientName: study.patientName,
      StudyInstanceUID: study.studyInstanceUid,
      StudyTime: study.time,
    };
  });
}

function _mapDisplaySets(displaySets, thumbnailImageSrcMap) {
  console.warn('~~ setLocalDisplaySetsState');
  return displaySets.map(ds => {
    const imageSrc = thumbnailImageSrcMap.get(ds.displaySetInstanceUID);
    return {
      displaySetInstanceUID: ds.displaySetInstanceUID,
      description: ds.SeriesDescription,
      seriesNumber: ds.SeriesNumber,
      modality: ds.Modality,
      date: ds.SeriesDate,
      numInstances: ds.numImageFrames,
      StudyInstanceUID: ds.StudyInstanceUID,
      componentType: 'thumbnail', // 'thumbnailNoImage' || 'thumbnailTracked' // TODO: PUT THIS SOMEWHERE ELSE
      imageSrc,
      dragData: {
        type: 'displayset',
        displaySetInstanceUID: ds.displaySetInstanceUID,
        // .. Any other data to pass
      },
    };
  });
}

/**
 *
 * @param {string[]} primaryStudyInstanceUIDs
 * @param {object[]} studyDisplayList
 * @param {string} studyDisplayList.studyInstanceUid
 * @param {string} studyDisplayList.date
 * @param {string} studyDisplayList.description
 * @param {string} studyDisplayList.modalities
 * @param {number} studyDisplayList.numInstances
 * @param {object[]} displaySets
 * @returns tabs - The prop object expected by the StudyBrowser component
 */
function _createStudyBrowserTabs(
  primaryStudyInstanceUIDs,
  studyDisplayList,
  displaySets
) {
  const primaryStudies = [];
  const recentStudies = [];
  const allStudies = [];

  studyDisplayList.forEach(study => {
    const displaySetsForStudy = displaySets.filter(
      ds => ds.StudyInstanceUID === study.studyInstanceUid
    );
    const tabStudy = Object.assign({}, study, {
      displaySets: displaySetsForStudy,
    });

    if (primaryStudyInstanceUIDs.includes(study.studyInstanceUid)) {
      primaryStudies.push(tabStudy);
    } else {
      // TODO: Filter allStudies to dates within one year of current date
      recentStudies.push(tabStudy);
      allStudies.push(tabStudy);
    }
  });

  const tabs = [
    {
      name: 'primary',
      label: 'Primary',
      studies: primaryStudies,
    },
    {
      name: 'recent',
      label: 'Recent',
      studies: recentStudies,
    },
    {
      name: 'all',
      label: 'All',
      studies: allStudies,
    },
  ];

  return tabs;
}