import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {v4 as uuidv4} from "uuid";
import dayjs from "dayjs";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import type {BookmarkType} from "./types";
import {GlobalModel, GlobalCommandRunner} from "./model";
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function LinkRenderer(props : any) : any {
    let newUrl = "https://extern?" + encodeURIComponent(props.href);
    return <a href={newUrl} target="_blank">{props.children}</a>
}

function HeaderRenderer(props : any, hnum : number) : any {
    return (
        <div className={cn("title", "is-" + hnum)}>{props.children}</div>
    );
}

function CodeRenderer(props : any) : any {
    return (
        <code className={cn({"inline": props.inline})}>{props.children}</code>
    );
}

@mobxReact.observer
class Bookmark extends React.Component<{bookmark : BookmarkType}, {}> {
    @boundMethod
    handleDeleteClick() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.handleDeleteBookmark(bookmark.bookmarkid);
    }

    @boundMethod
    handleEditClick() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.handleEditBookmark(bookmark.bookmarkid);
    }

    @boundMethod
    handleEditCancel() : void {
        let model = GlobalModel.bookmarksModel;
        model.cancelEdit();
        return;
    }

    @boundMethod
    handleEditUpdate() : void {
        let model = GlobalModel.bookmarksModel;
        model.confirmEdit();
        return;
    }

    @boundMethod
    handleDescChange(e : any) : void {
        let model = GlobalModel.bookmarksModel;
        mobx.action(() => {
            model.tempDesc.set(e.target.value);
        })();
    }

    @boundMethod
    handleCmdChange(e : any) : void {
        let model = GlobalModel.bookmarksModel;
        mobx.action(() => {
            model.tempCmd.set(e.target.value);
        })();
    }

    @boundMethod
    handleClick() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.selectBookmark(bookmark.bookmarkid);
    }

    @boundMethod
    handleUse() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.useBookmark(bookmark.bookmarkid);
    }
    
    render() {
        let bm = this.props.bookmark;
        let model = GlobalModel.bookmarksModel;
        let isSelected = (model.activeBookmark.get() == bm.bookmarkid);
        let markdown = bm.description ?? "";
        let markdownComponents = {
            a: LinkRenderer,
            h1: (props) => HeaderRenderer(props, 1),
            h2: (props) => HeaderRenderer(props, 2),
            h3: (props) => HeaderRenderer(props, 3),
            h4: (props) => HeaderRenderer(props, 4),
            h5: (props) => HeaderRenderer(props, 5),
            h6: (props) => HeaderRenderer(props, 6),
            code: CodeRenderer,
        };
        let hasDesc = markdown != "";
        let isEditing = (model.editingBookmark.get() == bm.bookmarkid);
        if (isEditing) {
            return (
                <div data-bookmarkid={bm.bookmarkid} className={cn("bookmark focus-parent is-editing", {"pending-delete": model.pendingDelete.get() == bm.bookmarkid})}>
                    <div className={cn("focus-indicator", {"active": isSelected})}/>
                    <div className="bookmark-edit">
                        <div className="field">
                            <label className="label">Description (markdown)</label>
                            <div className="control">
                                <textarea className="textarea mono-font" rows={6} value={model.tempDesc.get()} onChange={this.handleDescChange}/>
                            </div>
                        </div>
                        <div className="field">
                            <label className="label">Command</label>
                            <div className="control">
                                <textarea className="textarea mono-font" rows={3} value={model.tempCmd.get()} onChange={this.handleCmdChange}/>
                            </div>
                        </div>
                        <div className="field is-grouped">
                            <div className="control">
                                <button className="button is-link" onClick={this.handleEditUpdate}>Update</button>
                            </div>
                            <div className="control">
                                <button className="button" onClick={this.handleEditCancel}>Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div className={cn("bookmark focus-parent", {"pending-delete": model.pendingDelete.get() == bm.bookmarkid})} onClick={this.handleClick}>
                <div className={cn("focus-indicator", {"active": isSelected})}/>
                <div className="bookmark-id-div">{bm.bookmarkid.substr(0, 8)}</div>
                <div className="bookmark-content">
                    <If condition={hasDesc}>
                        <div className="markdown">
                            <ReactMarkdown children={markdown} remarkPlugins={[remarkGfm]} components={markdownComponents}/>
                        </div>
                    </If>
                    <div className={cn("bookmark-code", {"no-desc": !hasDesc})}>
                        <div className="use-button" title="Use Bookmark" onClick={this.handleUse}><i className="fa fa-check"/></div>
                        <code>{bm.cmdstr}</code>
                    </div>
                </div>
                <div className="bookmark-controls">
                    <div className="bookmark-control" onClick={this.handleEditClick}><i className="fa fa-pencil"/></div>
                    <div className="bookmark-control" onClick={this.handleDeleteClick}><i className="fa fa-trash"/></div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class BookmarksView extends React.Component<{}, {}> {
    @boundMethod
    clickHandler() : void {
        GlobalModel.bookmarksModel.closeView();
    }
    
    render() {
        let isHidden = (GlobalModel.activeMainView.get() != "bookmarks");
        let bookmarks = GlobalModel.bookmarksModel.bookmarks;
        let idx : number = 0;
        let bookmark : BookmarkType = null;
        return (
            <div className={cn("bookmarks-view", {"is-hidden": isHidden})}>
                <div className="close-button" onClick={this.clickHandler}><i className="fa fa-times"></i></div>
                <div className="bookmarks-title">
                    <i className="fa fa-bookmark" style={{marginRight: 10}}/>
                    BOOKMARKS
                </div>
                <div className="bookmarks-list">
                    <For index="idx" each="bookmark" of={bookmarks}>
                        <Bookmark key={bookmark.bookmarkid} bookmark={bookmark}/>
                    </For>
                    <If condition={bookmarks.length == 0}>
                        <div className="no-bookmarks">
                            No Bookmarks.<br/>
                            Use the <i className="fa fa-bookmark"/> icon on commands to add your first bookmark.
                        </div>
                    </If>
                </div>
                <If condition={bookmarks.length > 0}>
                    <div className="bookmarks-help">
                        <div className="help-entry">
                            [Enter] to Use Bookmark<br/>
                            [Backspace/Delete]x2 or <i className="fa fa-trash"/> to Delete<br/>
                            [Arrow Up]/[Arrow Down]/[PageUp]/[PageDown] to Move in List<br/>
                            [e] or <i className="fa fa-pencil"/> to Edit<br/>
                        </div>
                    </div>
                </If>
            </div>
        );
    }
}

export {BookmarksView};
