import React, { lazy, Suspense } from 'react';

import { useSelector } from 'react-redux';
import { Route, Routes } from 'react-router-dom';

import Spinner from '../../components/Spinner';
import { Routes as ROUTES } from '../../data/constants';

const PostEditor = lazy(() => import('../posts/post-editor/PostEditor'));
const PostCommentsView = lazy(() => import('../post-comments/PostCommentsView'));

const DiscussionContent = () => {
  const postEditorVisible = useSelector((state) => state.threads.postEditorVisible);

  return (
    <div className="d-flex bg-light-400 flex-column w-75 w-xs-100 w-xl-75 align-items-center">
      <div className="d-flex flex-column w-100">
        <Suspense fallback={(<Spinner />)}>
          <Routes>
            {postEditorVisible ? (
              ROUTES.POSTS.NEW_POST.map(path => (
                <Route key={path} path={path} element={<PostEditor />} />
              ))
            ) : (
              <>
                {ROUTES.POSTS.EDIT_POST.map(path => (
                  <Route key={path} path={path} element={<PostEditor editExisting />} />
                ))}
                {ROUTES.COMMENTS.PATH.map(path => (
                  <Route key={path} path={path} element={<PostCommentsView />} />
                ))}
              </>
            )}
          </Routes>
        </Suspense>
      </div>
    </div>
  );
};

export default DiscussionContent;
